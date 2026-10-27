-- Relive CRM 0005: integrations.
--   Inbound:  every lead source (Facebook / Instagram lead ads, Google Ads lead forms, Google Forms, website,
--             LinkedIn through a connector, any webhook) goes through ingest_lead(), so each lead lands once,
--             keeps its campaign / ad set / ad / form, and gets the same assignment and alerts.
--   Outbound: Google Sheets mirror (master sheet plus per-vendor, per-source, per-project or per-team sheets),
--             kept current from a queue; email and push delivery state for notifications.
--   The web app's /api routes and the every-minute job runner do the network work with the service role.

-- ================================================================ vendors and routing
create table vendors (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  contact_name text,
  contact_email text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

alter table capture_endpoints
  add column provider text not null default 'webhook'
    check (provider in ('webhook', 'meta', 'google_ads', 'google_forms', 'linkedin', 'website', 'other')),
  add column vendor_id uuid references vendors(id),
  add column match_page_id text,
  add column match_form_ids text[] not null default '{}',
  add column is_default boolean not null default false;
-- one catch-all endpoint per provider: a form nobody has mapped yet still lands somewhere
create unique index capture_endpoints_one_default on capture_endpoints(provider) where is_default;

-- ================================================================ attribution
alter table enquiries
  add column provider text,
  add column external_id text,
  add column campaign_id text, add column campaign_name text,
  add column adset_id text, add column adset_name text,
  add column ad_id text, add column ad_name text,
  add column form_id text, add column form_name text,
  add column platform text,
  add column is_test boolean not null default false,
  add column answers jsonb;
create unique index enquiries_external_uniq on enquiries(provider, external_id) where external_id is not null;

alter table leads
  add column vendor_id uuid references vendors(id),
  add column provider text,
  add column campaign_id text, add column campaign_name text,
  add column adset_id text, add column adset_name text,
  add column ad_id text, add column ad_name text,
  add column form_id text, add column form_name text,
  add column platform text;
create index leads_vendor_idx on leads(vendor_id);
create index leads_campaign_idx on leads(campaign_id);

-- ================================================================ delivery log
create table integration_events (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  provider text not null,
  direction text not null default 'in' check (direction in ('in', 'out')),
  status text not null,          -- processed, duplicate, invalid_phone, unmapped, rejected, error, synced, sent
  endpoint_id uuid references capture_endpoints(id) on delete set null,
  lead_id uuid references leads(id) on delete set null,
  external_id text,
  message text,
  payload jsonb
);
create index integration_events_at_idx on integration_events(at desc);

-- Webhook deliveries are written here first (fast, durable), then processed. Anything that fails, e.g. Meta's
-- lead lookup timing out, is retried by the job runner with growing gaps, so no lead is lost to a hiccup.
create table inbound_queue (
  id bigint generated always as identity primary key,
  provider text not null,
  external_id text not null,
  payload jsonb not null,
  status text not null default 'pending' check (status in ('pending', 'done', 'failed')),
  attempts int not null default 0,
  next_at timestamptz not null default now(),
  last_error text,
  lead_id uuid references leads(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (provider, external_id)
);
create index inbound_queue_due_idx on inbound_queue(next_at) where status = 'pending';

-- ================================================================ secrets (never readable by staff)
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
create table private.secrets (
  key text primary key,
  value text not null,
  updated_at timestamptz not null default now()
);

-- Admins can set a secret from the Integrations screen but never read it back; only the server can read.
create or replace function public.integration_secret_set(p_key text, p_value text) returns void
language plpgsql security definer set search_path = public, private as $$
begin
  if public.app_current_role() is distinct from 'admin' and coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'only admins can change integration secrets' using errcode = '42501';
  end if;
  if p_key !~ '^[a-z0-9_:.-]{3,80}$' then raise exception 'bad key name'; end if;
  if nullif(btrim(p_value), '') is null then
    delete from private.secrets where key = p_key;
  else
    insert into private.secrets(key, value) values (p_key, btrim(p_value))
    on conflict (key) do update set value = excluded.value, updated_at = now();
  end if;
end $$;

create or replace function public.integration_secret_get(p_key text) returns text
language sql stable security definer set search_path = private as $$
  select value from private.secrets where key = p_key
$$;

create or replace function public.integration_secret_status() returns table(key text, updated_at timestamptz)
language sql stable security definer set search_path = public, private as $$
  select s.key, s.updated_at from private.secrets s where public.app_current_role() = 'admin' order by s.key
$$;

-- ================================================================ ingest
-- Which endpoint a provider's lead belongs to: a form-level match, then a page-level match, then the
-- provider's catch-all. Returns null when nothing matches (the lead is still saved, unassigned).
create or replace function public.route_endpoint(p_provider text, p_page_id text, p_form_id text) returns uuid
language sql stable security definer set search_path = public as $$
  select id from (
    select id, 1 as rank from capture_endpoints
     where active and provider = p_provider and p_form_id is not null and p_form_id = any(match_form_ids)
    union all
    select id, 2 from capture_endpoints
     where active and provider = p_provider and p_page_id is not null and match_page_id = p_page_id
       and cardinality(match_form_ids) = 0
    union all
    select id, 3 from capture_endpoints where active and provider = p_provider and is_default
  ) m order by rank limit 1
$$;

-- p: provider, external_id, phone, name, email, city, answer, answers (object of question -> answer),
--    received_at, campaign_id, campaign_name, adset_id, adset_name, ad_id, ad_name, form_id, form_name,
--    platform, is_test, raw (original payload).
create or replace function public.ingest_lead(p_endpoint uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  ep capture_endpoints%rowtype;
  v_provider text := coalesce(nullif(p ->> 'provider', ''), 'webhook');
  v_ext text := nullif(p ->> 'external_id', '');
  v_phone text := public.normalize_phone(p ->> 'phone');
  v_name text := nullif(btrim(p ->> 'name'), '');
  v_email text := nullif(btrim(p ->> 'email'), '');
  v_city text := nullif(btrim(p ->> 'city'), '');
  v_answer text := nullif(btrim(p ->> 'answer'), '');
  v_answers jsonb := case when jsonb_typeof(p -> 'answers') = 'object' then p -> 'answers' end;
  v_received timestamptz;
  v_person uuid; v_lead uuid; v_enq uuid; v_stage uuid; v_assignee uuid; v_owner uuid;
  v_re boolean := false; v_label text; v_summary text; v_status text;
begin
  if p_endpoint is not null then
    select * into ep from capture_endpoints where id = p_endpoint;
  end if;
  if v_ext is not null then
    select lead_id into v_lead from enquiries where provider = v_provider and external_id = v_ext;
    if found then
      insert into integration_events(provider, status, endpoint_id, lead_id, external_id, message)
      values (v_provider, 'duplicate', p_endpoint, v_lead, v_ext, 'already received');
      return jsonb_build_object('status', 'duplicate', 'lead_id', v_lead);
    end if;
  end if;
  begin
    v_received := coalesce(nullif(p ->> 'received_at', '')::timestamptz, now());
  exception when others then v_received := now();
  end;
  -- answers become a readable line on the lead, e.g. "Budget: 50 L to 1 Cr · When: Within 3 months"
  select string_agg(initcap(replace(key, '_', ' ')) || ': ' || value, ' · ')
    into v_summary from jsonb_each_text(coalesce(v_answers, '{}'::jsonb)) where nullif(btrim(value), '') is not null;
  v_answer := coalesce(v_answer, v_summary);

  if v_phone is null then
    insert into enquiries(endpoint_id, source_id, project_id, status, answer, raw_payload, received_at,
                          provider, external_id, campaign_id, campaign_name, adset_id, adset_name, ad_id, ad_name,
                          form_id, form_name, platform, is_test, answers)
    values (ep.id, ep.source_id, ep.project_id, 'invalid_phone', v_answer, coalesce(p -> 'raw', p), v_received,
            v_provider, v_ext, p ->> 'campaign_id', p ->> 'campaign_name', p ->> 'adset_id', p ->> 'adset_name',
            p ->> 'ad_id', p ->> 'ad_name', p ->> 'form_id', p ->> 'form_name', p ->> 'platform',
            coalesce((p ->> 'is_test')::boolean, false), v_answers)
    returning id into v_enq;
    insert into integration_events(provider, status, endpoint_id, external_id, message)
    values (v_provider, 'invalid_phone', ep.id, v_ext, coalesce(v_name, 'no name') || ': ' || coalesce(p ->> 'phone', 'no phone'));
    perform public.notify(pr.id, 'lead_invalid', 'Lead with an unusable phone number',
                          coalesce(v_name, 'No name') || ' · ' || coalesce(p ->> 'phone', 'no phone') || coalesce(' · ' || (p ->> 'form_name'), ''))
       from profiles pr where pr.role = 'admin' and pr.active;
    return jsonb_build_object('status', 'invalid_phone', 'enquiry_id', v_enq);
  end if;

  insert into people(phone_e164, full_name, email, city)
  values (v_phone, v_name, v_email, v_city)
  on conflict (phone_e164) do update set
    full_name = coalesce(people.full_name, excluded.full_name),
    email = coalesce(people.email, excluded.email),
    city = coalesce(people.city, excluded.city),
    updated_at = now()
  returning id into v_person;

  select l.id, l.assigned_to into v_lead, v_owner from leads l join stages s on s.id = l.stage_id
   where l.person_id = v_person and l.project_id is not distinct from ep.project_id and s.kind = 'open'
   order by l.created_at desc limit 1;

  if v_lead is not null then
    v_re := true;
    update leads set
      reenquiry_count = reenquiry_count + 1,
      temperature = case when temperature = 'cold' then 'warm'::temperature else temperature end,
      next_followup_at = least(coalesce(next_followup_at, now()), now()),
      last_activity_at = now()
    where id = v_lead;
    insert into activities(lead_id, type, notes, completed_at)
    values (v_lead, 're_enquiry', coalesce(v_answer, 'Enquired again') || coalesce(' (' || nullif(p ->> 'form_name', '') || ')', ''), now());
    perform public.notify(v_owner, 'reenquiry', 'Your lead enquired again', public.lead_label(v_lead), v_lead);
  else
    select id into v_stage from stages where is_default;
    v_assignee := public.pick_assignee(ep.team_id);
    insert into leads(person_id, project_id, source_id, stage_id, assigned_to, next_followup_at, created_at, description,
                      vendor_id, provider, campaign_id, campaign_name, adset_id, adset_name, ad_id, ad_name,
                      form_id, form_name, platform)
    values (v_person, ep.project_id, ep.source_id, v_stage, v_assignee, now(), v_received, v_answer,
            ep.vendor_id, v_provider, p ->> 'campaign_id', p ->> 'campaign_name', p ->> 'adset_id', p ->> 'adset_name',
            p ->> 'ad_id', p ->> 'ad_name', p ->> 'form_id', p ->> 'form_name', p ->> 'platform')
    returning id into v_lead;
    v_label := public.lead_label(v_lead);
    if v_assignee is null then
      -- nobody to give it to: admins, and the team leaders of that team, are told straight away
      perform public.notify(pr.id, 'lead_unassigned', 'New lead waiting to be assigned', v_label, v_lead)
         from profiles pr
        where pr.active and (pr.role = 'admin' or (pr.role = 'manager' and ep.team_id is not null and pr.team_id = ep.team_id));
    end if;
    -- people who asked to hear about every new lead they can see
    perform public.notify(ns.user_id, 'lead_new', 'New lead: ' || coalesce(v_name, v_phone), v_label, v_lead)
       from notification_settings ns join profiles pr on pr.id = ns.user_id
      where ns.all_new_leads and pr.active and ns.user_id is distinct from v_assignee
        and (pr.role = 'admin' or (pr.role = 'manager' and ep.team_id is not null and pr.team_id = ep.team_id));
  end if;

  insert into enquiries(endpoint_id, person_id, lead_id, source_id, project_id, status, answer, raw_payload, received_at,
                        provider, external_id, campaign_id, campaign_name, adset_id, adset_name, ad_id, ad_name,
                        form_id, form_name, platform, is_test, answers)
  values (ep.id, v_person, v_lead, ep.source_id, ep.project_id, 'processed', v_answer, coalesce(p -> 'raw', p), v_received,
          v_provider, v_ext, p ->> 'campaign_id', p ->> 'campaign_name', p ->> 'adset_id', p ->> 'adset_name',
          p ->> 'ad_id', p ->> 'ad_name', p ->> 'form_id', p ->> 'form_name', p ->> 'platform',
          coalesce((p ->> 'is_test')::boolean, false), v_answers)
  returning id into v_enq;

  v_status := case when ep.id is null then 'unmapped' else 'processed' end;
  insert into integration_events(provider, status, endpoint_id, lead_id, external_id, message)
  values (v_provider, v_status, ep.id, v_lead, v_ext,
          case when v_re then 're-enquiry' when ep.id is null then 'no endpoint matched this form; saved unassigned' else 'new lead' end
          || coalesce(' · ' || nullif(p ->> 'form_name', ''), ''));

  return jsonb_build_object('status', 'processed', 'reenquiry', v_re,
                            'person_id', v_person, 'lead_id', v_lead, 'enquiry_id', v_enq,
                            'endpoint_id', ep.id,
                            'assigned_to', (select assigned_to from leads where id = v_lead));
end $$;

-- The original slug + secret capture (website forms, Zapier, Google Forms) now uses ingest_lead too.
create or replace function public.capture_enquiry(p_slug text, p_secret_hash text, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  ep capture_endpoints%rowtype;
  m jsonb;
  v_answers jsonb;
  v_known text[];
begin
  select * into ep from capture_endpoints where slug = p_slug and active;
  if not found or ep.secret_hash <> p_secret_hash then
    raise exception 'unknown or unauthorised endpoint' using errcode = '28000';
  end if;
  -- automation tools retry on timeouts: an identical delivery within 5 minutes is not a new enquiry
  if exists (select 1 from enquiries e where e.endpoint_id = ep.id and e.raw_payload = p_payload
               and e.created_at > now() - interval '5 minutes') then
    return jsonb_build_object('status', 'duplicate_delivery');
  end if;
  m := ep.field_map;
  v_known := array(select value from jsonb_each_text(m)) || array['secret', 'key', 'external_id', 'campaign', 'campaign_name',
             'adset', 'adset_name', 'ad', 'ad_name', 'form', 'form_name', 'utm_source', 'utm_medium', 'utm_campaign'];
  -- any other fields the form sends (budget, timeline, configuration...) are kept as answers
  select jsonb_object_agg(key, value) into v_answers from jsonb_each_text(p_payload)
   where not key = any(v_known) and nullif(btrim(value), '') is not null and length(value) < 500;
  return public.ingest_lead(ep.id, jsonb_build_object(
    'provider', case when ep.provider in ('webhook', 'google_forms', 'website', 'linkedin', 'other') then ep.provider else 'webhook' end,
    'external_id', p_payload ->> 'external_id',
    'phone', p_payload ->> (m ->> 'phone'),
    'name', p_payload ->> (m ->> 'name'),
    'email', p_payload ->> (m ->> 'email'),
    'city', p_payload ->> (m ->> 'city'),
    'answer', p_payload ->> (m ->> 'answer'),
    'answers', v_answers,
    'received_at', p_payload ->> (m ->> 'received_at'),
    'campaign_name', coalesce(p_payload ->> 'campaign_name', p_payload ->> 'campaign', p_payload ->> 'utm_campaign'),
    'adset_name', coalesce(p_payload ->> 'adset_name', p_payload ->> 'adset'),
    'ad_name', coalesce(p_payload ->> 'ad_name', p_payload ->> 'ad'),
    'form_name', coalesce(p_payload ->> 'form_name', p_payload ->> 'form', ep.name),
    'platform', p_payload ->> 'utm_source',
    'raw', p_payload));
end $$;

-- ================================================================ notification preferences and delivery
create table notification_settings (
  user_id uuid primary key references profiles(id) on delete cascade,
  push_enabled boolean not null default true,
  email_enabled boolean not null default true,
  email_kinds text[] not null default '{lead_assigned,lead_unassigned,reenquiry,lead_invalid}',
  all_new_leads boolean not null default false,
  updated_at timestamptz not null default now()
);
alter table notifications
  add column emailed_at timestamptz,
  add column email_status text;
create index notifications_unemailed_idx on notifications(created_at) where emailed_at is null;

-- The job runner claims undelivered notifications in one go (marks them, so two runners never double-send),
-- with everything needed to deliver them: where to push, whether and where to email.
create or replace function public.notification_claim(p_limit int default 100) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v jsonb;
begin
  with picked as (
    select n.id from notifications n
     where n.created_at > now() - interval '2 days' and (n.pushed_at is null or n.emailed_at is null)
     order by n.created_at limit p_limit for update skip locked
  ), rows as (
    select n.*, pr.full_name, u.email,
           coalesce(ns.push_enabled, true) as push_enabled,
           coalesce(ns.email_enabled, true) and n.kind = any(coalesce(ns.email_kinds, '{lead_assigned,lead_unassigned,reenquiry,lead_invalid}'::text[])) as email_wanted
      from notifications n join picked using (id)
      join profiles pr on pr.id = n.user_id
      left join auth.users u on u.id = n.user_id
      left join notification_settings ns on ns.user_id = n.user_id
  ), mark as (
    update notifications n set pushed_at = coalesce(n.pushed_at, now()),
           emailed_at = coalesce(n.emailed_at, now()),
           email_status = case when n.emailed_at is not null then n.email_status
                               when r.email_wanted and r.email is not null then 'queued' else 'skipped' end
      from rows r where n.id = r.id
    returning n.id
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', r.id, 'user_id', r.user_id, 'kind', r.kind, 'title', r.title, 'body', r.body, 'lead_id', r.lead_id,
           'created_at', r.created_at, 'name', r.full_name,
           'push', r.pushed_at is null and r.push_enabled,
           'email', case when r.emailed_at is null and r.email_wanted then r.email end,
           'subscriptions', coalesce((select jsonb_agg(jsonb_build_object('kind', s.kind, 'endpoint', s.endpoint, 'keys', s.keys))
                                        from push_subscriptions s where s.user_id = r.user_id), '[]'::jsonb))), '[]'::jsonb)
    into v from rows r where exists (select 1 from mark where mark.id = r.id);
  return v;
end $$;

create or replace function public.notification_email_result(p_id uuid, p_status text) returns void
language sql security definer set search_path = public as $$
  update notifications set email_status = left(p_status, 300) where id = p_id
$$;

create or replace function public.push_subscription_remove(p_endpoint text) returns void
language sql security definer set search_path = public as $$
  delete from push_subscriptions where endpoint = p_endpoint
$$;

-- ================================================================ Google Sheets mirror
create table sheet_targets (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  spreadsheet_id text not null,
  tab_name text not null default 'Leads',
  scope text not null default 'all' check (scope in ('all', 'vendor', 'source', 'project', 'team')),
  scope_id uuid,
  include_tests boolean not null default false,
  active boolean not null default true,
  last_synced_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  check ((scope = 'all') = (scope_id is null))
);

create table sheet_queue (
  lead_id uuid primary key references leads(id) on delete cascade,
  queued_at timestamptz not null default now(),
  attempts int not null default 0
);

create or replace function public.queue_sheet(p_lead uuid) returns void
language sql security definer set search_path = public as $$
  insert into sheet_queue(lead_id) select p_lead
   where p_lead is not null and exists (select 1 from sheet_targets where active)
  on conflict (lead_id) do update set queued_at = now()
$$;

create or replace function public.sheet_queue_trigger() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_table_name = 'leads' then perform public.queue_sheet(new.id);
  else perform public.queue_sheet(new.lead_id); end if;
  return null;
end $$;
create trigger sheet_queue_leads after insert or update on leads for each row execute function public.sheet_queue_trigger();
create trigger sheet_queue_notes after insert on lead_notes for each row execute function public.sheet_queue_trigger();
create trigger sheet_queue_activities after insert on activities for each row execute function public.sheet_queue_trigger();
create trigger sheet_queue_calls after insert or update on calls for each row when (new.lead_id is not null) execute function public.sheet_queue_trigger();
create trigger sheet_queue_tasks after insert or update on tasks for each row when (new.lead_id is not null) execute function public.sheet_queue_trigger();

-- One row per lead as it appears in the sheets. Times in India time, phone kept as text.
create view lead_sheet_rows with (security_invoker = true) as
select
  l.id as lead_id,
  to_char(l.created_at at time zone 'Asia/Kolkata', 'YYYY-MM-DD HH24:MI') as created,
  pe.full_name as name,
  pe.phone_e164 as phone,
  pe.email, pe.city,
  pr.name as project,
  so.name as source,
  ve.name as vendor,
  l.provider, l.campaign_name, l.adset_name, l.ad_name, l.form_name,
  st.name as stage,
  l.temperature::text as temperature,
  l.priority,
  ag.full_name as assigned_to,
  to_char(l.next_followup_at at time zone 'Asia/Kolkata', 'YYYY-MM-DD HH24:MI') as next_followup,
  rm.remark as last_remark,
  to_char(rm.at at time zone 'Asia/Kolkata', 'YYYY-MM-DD HH24:MI') as last_remark_at,
  (select count(*) from calls c where c.lead_id = l.id) as calls,
  l.reenquiry_count as reenquiries,
  lr.name as lost_reason,
  l.description as form_answers,
  to_char(l.updated_at at time zone 'Asia/Kolkata', 'YYYY-MM-DD HH24:MI') as updated,
  -- for choosing which sheets a lead belongs to
  l.vendor_id, l.source_id, l.project_id, ag.team_id,
  coalesce((select bool_or(e.is_test) from enquiries e where e.lead_id = l.id), false) as is_test
from leads l
join people pe on pe.id = l.person_id
join stages st on st.id = l.stage_id
left join projects pr on pr.id = l.project_id
left join sources so on so.id = l.source_id
left join vendors ve on ve.id = l.vendor_id
left join profiles ag on ag.id = l.assigned_to
left join lost_reasons lr on lr.id = l.lost_reason_id
left join lateral (
  select x.remark, x.at from (
    select n.body as remark, n.created_at as at from lead_notes n where n.lead_id = l.id
    union all
    select coalesce(nullif(a.notes, ''), a.outcome), coalesce(a.completed_at, a.created_at) from activities a
     where a.lead_id = l.id and a.type <> 'system' and coalesce(nullif(a.notes, ''), a.outcome) is not null
    union all
    select concat_ws(' · ', c.outcome, c.notes), c.started_at from calls c where c.lead_id = l.id and (c.outcome is not null or c.notes is not null)
  ) x order by x.at desc limit 1
) rm on true;

-- The job runner takes a batch off the queue (and gets it back with sheet_requeue if a sheet call fails).
create or replace function public.sheet_claim(p_limit int default 300) returns setof lead_sheet_rows
language sql security definer set search_path = public as $$
  with picked as (
    delete from sheet_queue where lead_id in (
      select lead_id from sheet_queue where queued_at <= now() order by queued_at limit p_limit for update skip locked)
    returning lead_id
  )
  select r.* from lead_sheet_rows r join picked p on p.lead_id = r.lead_id
$$;

create or replace function public.sheet_requeue(p_leads uuid[]) returns void
language sql security definer set search_path = public as $$
  insert into sheet_queue(lead_id, attempts) select unnest(p_leads), 1
  on conflict (lead_id) do update set attempts = sheet_queue.attempts + 1, queued_at = now() + make_interval(mins => least(sheet_queue.attempts, 30))
$$;

-- "Resync": put every lead (or every lead of one target's scope) back on the queue.
create or replace function public.sheet_resync(p_target uuid default null) returns int
language plpgsql security definer set search_path = public as $$
declare t sheet_targets%rowtype; n int;
begin
  if public.app_current_role() is distinct from 'admin' and coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'only admins can resync sheets' using errcode = '42501';
  end if;
  if p_target is not null then select * into t from sheet_targets where id = p_target; end if;
  insert into sheet_queue(lead_id)
  select r.lead_id from lead_sheet_rows r
   where p_target is null or t.scope = 'all'
      or (t.scope = 'vendor' and r.vendor_id = t.scope_id) or (t.scope = 'source' and r.source_id = t.scope_id)
      or (t.scope = 'project' and r.project_id = t.scope_id) or (t.scope = 'team' and r.team_id = t.scope_id)
  on conflict (lead_id) do update set queued_at = now();
  get diagnostics n = row_count;
  return n;
end $$;

-- ================================================================ row level security and grants
alter table vendors enable row level security;
alter table integration_events enable row level security;
alter table inbound_queue enable row level security;
alter table notification_settings enable row level security;
alter table sheet_targets enable row level security;
alter table sheet_queue enable row level security;

create policy vendors_read on vendors for select to authenticated using (public.app_current_role() is not null);
create policy vendors_admin on vendors for all to authenticated
  using (public.app_current_role() = 'admin') with check (public.app_current_role() = 'admin');
create policy integration_events_admin on integration_events for select to authenticated
  using (public.app_current_role() = 'admin');
create policy inbound_queue_admin on inbound_queue for select to authenticated
  using (public.app_current_role() = 'admin');
create policy notification_settings_own on notification_settings for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy notification_settings_admin_read on notification_settings for select to authenticated
  using (public.app_current_role() = 'admin');
create policy sheet_targets_admin on sheet_targets for all to authenticated
  using (public.app_current_role() = 'admin') with check (public.app_current_role() = 'admin');

revoke all on lead_sheet_rows from public, anon, authenticated;
grant select on lead_sheet_rows to service_role;

revoke all on function public.ingest_lead(uuid, jsonb), public.route_endpoint(text, text, text),
  public.integration_secret_get(text), public.notification_claim(int), public.notification_email_result(uuid, text),
  public.push_subscription_remove(text), public.sheet_claim(int), public.sheet_requeue(uuid[]), public.queue_sheet(uuid)
  from public, anon, authenticated;
grant execute on function public.ingest_lead(uuid, jsonb), public.route_endpoint(text, text, text),
  public.integration_secret_get(text), public.notification_claim(int), public.notification_email_result(uuid, text),
  public.push_subscription_remove(text), public.sheet_claim(int), public.sheet_requeue(uuid[]), public.queue_sheet(uuid)
  to service_role;
revoke all on function public.integration_secret_set(text, text), public.integration_secret_status(), public.sheet_resync(uuid)
  from public, anon;
grant execute on function public.integration_secret_set(text, text), public.integration_secret_status(), public.sheet_resync(uuid)
  to authenticated, service_role;
