-- Relive CRM 0013: Facebook lead routing the way Relive already names its forms, learned from Cratio's set-up.
--   Cratio needed one hand-made mapping per form (about 45), each stamping a fixed lead source, project, owner and
--   priority. Relive's form names already carry that: "LPM 2.O-DFBL - SACHIN", "HNI CAROUSEL 1 - HFBL".
--   * A Page-wide or catch-all entry now reads the lead source code and the project from the form name (then the
--     campaign and ad set names), so every current and future form is tagged without a mapping.
--     An entry for specific form IDs still decides both itself.
--   * Optional intake person per entry (Cratio sends every Facebook lead to one person first).
--   * Default priority per entry (Cratio uses High for Facebook leads).
--   * Form answers fill budget, location, BHK, property type and timing when the question says what it is.
--   (Overseas WhatsApp numbers already keep their country code: only numbers without "+" are read as Indian.)

alter table capture_endpoints
  add column assign_to uuid references profiles(id) on delete set null,
  add column default_priority text check (default_priority in ('High', 'Medium', 'Low'));

-- the longest active lead source name that appears as a whole word, e.g. "BTFBL" in "SAHU CITY PEARL - BTFBL"
create or replace function public.source_from_text(t text) returns uuid
language sql stable security definer set search_path = public as $$
  select id from sources
   where active and t is not null and length(name) >= 3
     and upper(t) ~ ('(^|[^A-Z0-9])' || regexp_replace(upper(name), '([.^$*+?()\[\]{}|\\])', '\\\1', 'g') || '([^A-Z0-9]|$)')
   order by length(name) desc limit 1
$$;

-- the longest active project name in the text, e.g. "Rishita Serenity" rather than "Rishita"
create or replace function public.project_from_text(t text) returns uuid
language sql stable security definer set search_path = public as $$
  select id from projects
   where active and t is not null and length(name) >= 3
     and upper(regexp_replace(t, '[^A-Za-z0-9]+', ' ', 'g')) ~ ('(^| )' || upper(regexp_replace(name, '[^A-Za-z0-9]+', ' ', 'g')) || '( |$)')
   order by length(name) desc limit 1
$$;

-- fill empty lead fields from form answers whose question says what they are
create or replace function public.apply_answers(p_lead uuid, p_answers jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare a record; v_budget text; v_loc text; v_bhk text; v_type text; v_when text;
begin
  if p_lead is null or jsonb_typeof(p_answers) is distinct from 'object' then return; end if;
  for a in select lower(key) k, left(btrim(value), 120) v from jsonb_each_text(p_answers) where nullif(btrim(value), '') is not null loop
    if v_budget is null and a.k ~ 'budget|price|invest' then v_budget := a.v;
    elsif v_bhk is null and a.k ~ 'bhk|configuration|bedroom' then v_bhk := a.v;
    elsif v_type is null and a.k ~ 'property_type|type_of_property|looking_for|kind_of' then v_type := a.v;
    elsif v_loc is null and a.k ~ 'location|locality|area|where|road|sector' then v_loc := a.v;
    elsif v_when is null and a.k ~ 'when|timeline|planning|possession|purchase_time|time_frame' then v_when := a.v;
    end if;
  end loop;
  update leads set budget_band = coalesce(budget_band, v_budget), bhk = coalesce(bhk, v_bhk),
                   property_type = coalesce(property_type, v_type), location_pref = coalesce(location_pref, v_loc),
                   possession_pref = coalesce(possession_pref, v_when)
   where id = p_lead and (v_budget is not null or v_bhk is not null or v_type is not null or v_loc is not null or v_when is not null);
end $$;

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
  v_source uuid; v_project uuid; v_named text;
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

  -- lead source and project: an entry for specific forms decides them; a Page-wide or catch-all entry reads them
  -- from the form / campaign / ad set name first (Relive names forms "PROJECT - DFBL - ..."), then falls back.
  v_named := concat_ws(' ', p ->> 'form_name', p ->> 'campaign_name', p ->> 'adset_name');
  if ep.id is not null and cardinality(ep.match_form_ids) > 0 then
    v_source := ep.source_id; v_project := ep.project_id;
  else
    v_source := coalesce(public.source_from_text(v_named), ep.source_id);
    v_project := coalesce(public.project_from_text(v_named), ep.project_id);
  end if;

  if v_phone is null then
    insert into enquiries(endpoint_id, source_id, project_id, status, answer, raw_payload, received_at,
                          provider, external_id, campaign_id, campaign_name, adset_id, adset_name, ad_id, ad_name,
                          form_id, form_name, platform, is_test, answers)
    values (ep.id, v_source, v_project, 'invalid_phone', v_answer, coalesce(p -> 'raw', p), v_received,
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
   where l.person_id = v_person and l.project_id is not distinct from v_project and s.kind = 'open'
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
    -- a named intake person (like Cratio's "Assigned To" default) wins; otherwise round robin in the team
    select id into v_assignee from profiles where id = ep.assign_to and active;
    v_assignee := coalesce(v_assignee, public.pick_assignee(ep.team_id));
    insert into leads(person_id, project_id, source_id, stage_id, assigned_to, next_followup_at, created_at, description,
                      vendor_id, provider, campaign_id, campaign_name, adset_id, adset_name, ad_id, ad_name,
                      form_id, form_name, platform, priority)
    values (v_person, v_project, v_source, v_stage, v_assignee, now(), v_received, v_answer,
            ep.vendor_id, v_provider, p ->> 'campaign_id', p ->> 'campaign_name', p ->> 'adset_id', p ->> 'adset_name',
            p ->> 'ad_id', p ->> 'ad_name', p ->> 'form_id', p ->> 'form_name', p ->> 'platform',
            coalesce(ep.default_priority, 'Medium'))
    returning id into v_lead;
    perform public.apply_answers(v_lead, v_answers);
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
  values (ep.id, v_person, v_lead, v_source, v_project, 'processed', v_answer, coalesce(p -> 'raw', p), v_received,
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

revoke all on function public.source_from_text(text), public.project_from_text(text), public.apply_answers(uuid, jsonb) from public, anon;
grant execute on function public.source_from_text(text), public.project_from_text(text) to authenticated, service_role;
grant execute on function public.apply_answers(uuid, jsonb) to service_role;
