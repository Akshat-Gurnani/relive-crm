-- Relive CRM core schema. Single tenant. Row Level Security enforces access.
-- Requires Supabase's auth schema (auth.users, auth.uid()).

create type app_role as enum ('admin','manager','agent','marketing','viewer');
create type stage_kind as enum ('open','won','lost');
create type temperature as enum ('hot','warm','cold');
create type activity_type as enum ('call','whatsapp','email','meeting','site_visit','note','re_enquiry','system');
create type call_direction as enum ('incoming','outgoing');
create type call_status as enum ('connected','not_connected','missed','rejected');
create type booking_status as enum ('pending','confirmed','cancelled');
create type enquiry_status as enum ('processed','invalid_phone');

-- ---------------------------------------------------------------- organisation
create table teams (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  created_at timestamptz not null default now()
);

create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null,
  phone text,
  role app_role not null default 'agent',
  team_id uuid references teams(id),
  manager_id uuid references profiles(id),
  active boolean not null default true,
  accepting_leads boolean not null default true,
  last_assigned_at timestamptz,
  created_at timestamptz not null default now()
);
create index profiles_team_idx on profiles(team_id);

create table developers (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  created_at timestamptz not null default now()
);

create table projects (
  id uuid primary key default gen_random_uuid(),
  developer_id uuid references developers(id),
  name text not null unique,
  city text,
  property_type text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table team_projects (
  team_id uuid not null references teams(id) on delete cascade,
  project_id uuid not null references projects(id) on delete cascade,
  primary key (team_id, project_id)
);

-- ---------------------------------------------------------------- reference data
create table sources (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  active boolean not null default true
);

create table stages (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  kind stage_kind not null,
  position int not null,
  is_default boolean not null default false
);
create unique index stages_one_default on stages(is_default) where is_default;

create table lost_reasons (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  active boolean not null default true
);

-- ---------------------------------------------------------------- capture config
create table capture_endpoints (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  source_id uuid references sources(id),
  project_id uuid references projects(id),
  team_id uuid references teams(id),
  secret_hash text not null,
  field_map jsonb not null default
    '{"name":"contact","phone":"mobile","email":"email","city":"city","answer":"category","received_at":"date"}',
  active boolean not null default true,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------- people and leads
create table people (
  id uuid primary key default gen_random_uuid(),
  phone_e164 text not null unique,
  full_name text,
  email text,
  alt_phone text,
  city text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table leads (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references people(id),
  project_id uuid references projects(id),
  source_id uuid references sources(id),
  stage_id uuid not null references stages(id),
  temperature temperature not null default 'warm',
  assigned_to uuid references profiles(id),
  budget_min numeric,
  budget_max numeric,
  unit_size text,
  possession_pref text,
  location_pref text,
  next_followup_at timestamptz,
  next_followup_note text,
  first_contacted_at timestamptz,
  last_activity_at timestamptz not null default now(),
  reenquiry_count int not null default 0,
  lost_reason_id uuid references lost_reasons(id),
  lost_remarks text,
  lost_at timestamptz,
  converted_at timestamptz,
  stage_changed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index leads_person_idx on leads(person_id);
create index leads_project_idx on leads(project_id);
create index leads_assignee_stage_idx on leads(assigned_to, stage_id);
create index leads_followup_idx on leads(next_followup_at);

create table lead_stage_history (
  id bigint generated always as identity primary key,
  lead_id uuid not null references leads(id) on delete cascade,
  from_stage_id uuid references stages(id),
  to_stage_id uuid not null references stages(id),
  changed_by uuid,
  changed_at timestamptz not null default now()
);
create index lead_stage_history_lead_idx on lead_stage_history(lead_id);

create table enquiries (
  id uuid primary key default gen_random_uuid(),
  endpoint_id uuid references capture_endpoints(id),
  person_id uuid references people(id),
  lead_id uuid references leads(id),
  source_id uuid references sources(id),
  project_id uuid references projects(id),
  status enquiry_status not null,
  answer text,
  raw_payload jsonb not null,
  received_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index enquiries_person_idx on enquiries(person_id);
create index enquiries_received_idx on enquiries(received_at);
create index enquiries_endpoint_idx on enquiries(endpoint_id, created_at);

-- ---------------------------------------------------------------- work on leads
create table activities (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references leads(id) on delete cascade,
  type activity_type not null,
  assigned_to uuid references profiles(id),
  created_by uuid,
  due_at timestamptz,
  completed_at timestamptz,
  outcome text,
  notes text,
  created_at timestamptz not null default now()
);
create index activities_lead_idx on activities(lead_id);
create index activities_due_idx on activities(assigned_to, due_at) where completed_at is null;

create table site_visits (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references leads(id) on delete cascade,
  project_id uuid references projects(id),
  scheduled_at timestamptz not null,
  done_at timestamptz,
  accompanied_by uuid references profiles(id),
  notes text,
  created_at timestamptz not null default now()
);

create table calls (
  id uuid primary key default gen_random_uuid(),
  person_id uuid references people(id),
  lead_id uuid references leads(id),
  agent_id uuid references profiles(id),
  direction call_direction not null,
  status call_status not null,
  started_at timestamptz not null,
  ended_at timestamptz,
  duration_seconds int not null default 0,
  provider text,
  provider_call_id text,
  recording_path text,
  raw jsonb,
  created_at timestamptz not null default now(),
  unique (provider, provider_call_id)
);
create index calls_started_idx on calls(started_at);
create index calls_agent_idx on calls(agent_id, started_at);

create table bookings (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references leads(id),
  project_id uuid references projects(id),
  unit_ref text,
  booked_on date not null,
  deal_value numeric,
  commission_pct numeric,
  commission_amount numeric,
  status booking_status not null default 'pending',
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------- system tables
create table audit_log (
  id bigint generated always as identity primary key,
  actor uuid,
  table_name text not null,
  row_id uuid,
  op text not null,
  old_data jsonb,
  new_data jsonb,
  at timestamptz not null default now()
);
create index audit_log_at_idx on audit_log(at);

create table legacy_map (
  entity text not null,
  legacy_id text not null,
  new_id uuid not null,
  primary key (entity, legacy_id)
);

-- ================================================================ functions
create or replace function public.normalize_phone(p text) returns text
language plpgsql immutable as $$
declare d text;
begin
  if p is null then return null; end if;
  p := btrim(p);
  if p ~* '^[0-9.]+e[+-]?[0-9]+$' then return null; end if;  -- scientific notation from spreadsheets
  d := regexp_replace(p, '\D', '', 'g');
  if left(p, 1) = '+' then
    if length(d) between 8 and 15 then return '+' || d; end if;
    return null;
  end if;
  if left(d, 2) = '00' then
    d := substr(d, 3);
    if length(d) between 8 and 15 then return '+' || d; end if;
    return null;
  end if;
  if length(d) = 10 and d ~ '^[6-9]' then return '+91' || d; end if;
  if length(d) = 11 and left(d, 1) = '0' and substr(d, 2) ~ '^[6-9]' then return '+91' || substr(d, 2); end if;
  if length(d) = 12 and left(d, 2) = '91' and substr(d, 3) ~ '^[6-9]' then return '+' || d; end if;
  return null;
end $$;

create or replace function public.app_current_role() returns app_role
language sql stable security definer set search_path = public as $$
  select role from profiles where id = auth.uid() and active
$$;

create or replace function public.app_current_team() returns uuid
language sql stable security definer set search_path = public as $$
  select team_id from profiles where id = auth.uid() and active
$$;

create or replace function public.can_see_lead(p_assigned uuid, p_project uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(case public.app_current_role()
    when 'admin' then true
    when 'agent' then p_assigned = auth.uid()
    when 'manager' then
      (p_assigned is not null and public.app_current_team() is not null and exists (
         select 1 from profiles a where a.id = p_assigned and a.team_id = public.app_current_team()))
      or
      (p_assigned is null and p_project is not null and exists (
         select 1 from team_projects tp where tp.team_id = public.app_current_team() and tp.project_id = p_project))
    else false end, false)
$$;

create or replace function public.can_see_lead_id(p_lead uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from leads l where l.id = p_lead and public.can_see_lead(l.assigned_to, l.project_id))
$$;

-- round robin: the accepting agent in the team who was assigned longest ago
create or replace function public.pick_assignee(p_team uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare v uuid;
begin
  if p_team is null then return null; end if;
  select id into v from profiles
   where team_id = p_team and role = 'agent' and active and accepting_leads
   order by last_assigned_at nulls first, created_at
   limit 1 for update skip locked;
  if v is not null then update profiles set last_assigned_at = clock_timestamp() where id = v; end if;
  return v;
end $$;

-- ================================================================ triggers
create or replace function public.leads_before_update() returns trigger
language plpgsql security definer set search_path = public as $$
declare k stage_kind; r app_role;
begin
  r := public.app_current_role();
  if auth.uid() is not null and new.assigned_to is distinct from old.assigned_to
     and coalesce(r::text, '') not in ('admin', 'manager') then
    raise exception 'only managers or admins can reassign leads';
  end if;
  if new.stage_id is distinct from old.stage_id then
    select kind into k from stages where id = new.stage_id;
    if k = 'lost' and new.lost_reason_id is null then
      raise exception 'a lost reason is required when moving a lead to a lost stage';
    end if;
    if k = 'won' then new.converted_at := coalesce(new.converted_at, now()); end if;
    if k = 'lost' then new.lost_at := coalesce(new.lost_at, now()); end if;
    if k = 'open' then new.lost_at := null; new.converted_at := null; end if;
    new.stage_changed_at := now();
    new.last_activity_at := now();
  end if;
  new.updated_at := now();
  return new;
end $$;
create trigger leads_before_update before update on leads
  for each row execute function public.leads_before_update();

create or replace function public.leads_after_change() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    insert into lead_stage_history(lead_id, from_stage_id, to_stage_id, changed_by)
    values (new.id, null, new.stage_id, auth.uid());
  elsif new.stage_id is distinct from old.stage_id then
    insert into lead_stage_history(lead_id, from_stage_id, to_stage_id, changed_by)
    values (new.id, old.stage_id, new.stage_id, auth.uid());
  end if;
  return null;
end $$;
create trigger leads_after_change after insert or update on leads
  for each row execute function public.leads_after_change();

-- speed to lead: first completed contact activity, or first outgoing call
create or replace function public.activities_after_change() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.completed_at is not null and new.type in ('call', 'whatsapp', 'meeting') then
    update leads set first_contacted_at = coalesce(first_contacted_at, new.completed_at),
                     last_activity_at = greatest(last_activity_at, new.completed_at)
     where id = new.lead_id;
  end if;
  return null;
end $$;
create trigger activities_after_change after insert or update on activities
  for each row execute function public.activities_after_change();

create or replace function public.calls_after_insert() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.lead_id is not null and new.direction = 'outgoing' then
    update leads set first_contacted_at = coalesce(first_contacted_at, new.started_at),
                     last_activity_at = greatest(last_activity_at, new.started_at)
     where id = new.lead_id;
  end if;
  return null;
end $$;
create trigger calls_after_insert after insert on calls
  for each row execute function public.calls_after_insert();

create or replace function public.audit_row() returns trigger
language plpgsql security definer set search_path = public as $$
declare o jsonb; n jsonb;
begin
  o := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) - 'secret_hash' end;
  n := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) - 'secret_hash' end;
  insert into audit_log(actor, table_name, row_id, op, old_data, new_data)
  values (auth.uid(), tg_table_name, coalesce(n ->> 'id', o ->> 'id')::uuid, tg_op, o, n);
  return null;
end $$;
create trigger audit_leads after insert or update or delete on leads for each row execute function public.audit_row();
create trigger audit_profiles after insert or update or delete on profiles for each row execute function public.audit_row();
create trigger audit_endpoints after insert or update or delete on capture_endpoints for each row execute function public.audit_row();
create trigger audit_bookings after insert or update or delete on bookings for each row execute function public.audit_row();

-- ================================================================ capture
-- Called by the capture edge function with the service role. Never rejects an enquiry:
-- a repeat enquiry becomes an event on the existing person and re-opens the follow-up.
create or replace function public.capture_enquiry(p_slug text, p_secret_hash text, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  ep capture_endpoints%rowtype;
  m jsonb;
  v_phone text; v_name text; v_email text; v_city text; v_answer text;
  v_received timestamptz;
  v_person uuid; v_lead uuid; v_enq uuid; v_stage uuid; v_assignee uuid;
  v_re boolean := false;
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
  v_phone  := public.normalize_phone(p_payload ->> (m ->> 'phone'));
  v_name   := nullif(btrim(p_payload ->> (m ->> 'name')), '');
  v_email  := nullif(btrim(p_payload ->> (m ->> 'email')), '');
  v_city   := nullif(btrim(p_payload ->> (m ->> 'city')), '');
  v_answer := nullif(btrim(p_payload ->> (m ->> 'answer')), '');
  begin
    v_received := coalesce((p_payload ->> (m ->> 'received_at'))::timestamptz, now());
  exception when others then v_received := now();
  end;

  if v_phone is null then
    insert into enquiries(endpoint_id, source_id, project_id, status, answer, raw_payload, received_at)
    values (ep.id, ep.source_id, ep.project_id, 'invalid_phone', v_answer, p_payload, v_received)
    returning id into v_enq;
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

  select l.id into v_lead from leads l join stages s on s.id = l.stage_id
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
    values (v_lead, 're_enquiry', coalesce(v_answer, 'Enquired again'), now());
  else
    select id into v_stage from stages where is_default;
    v_assignee := public.pick_assignee(ep.team_id);
    insert into leads(person_id, project_id, source_id, stage_id, assigned_to, next_followup_at, created_at)
    values (v_person, ep.project_id, ep.source_id, v_stage, v_assignee, now(), v_received)
    returning id into v_lead;
  end if;

  insert into enquiries(endpoint_id, person_id, lead_id, source_id, project_id, status, answer, raw_payload, received_at)
  values (ep.id, v_person, v_lead, ep.source_id, ep.project_id, 'processed', v_answer, p_payload, v_received)
  returning id into v_enq;

  return jsonb_build_object('status', 'processed', 'reenquiry', v_re,
                            'person_id', v_person, 'lead_id', v_lead, 'enquiry_id', v_enq,
                            'assigned_to', (select assigned_to from leads where id = v_lead));
end $$;
revoke all on function public.capture_enquiry(text, text, jsonb) from public, anon, authenticated;
grant execute on function public.capture_enquiry(text, text, jsonb) to service_role;

-- ================================================================ views
-- non-personal directory for assignee names
create view staff_directory as
  select id, full_name, role, team_id, active from profiles
   where public.app_current_role() is not null;

-- aggregates for marketing and viewers: no names, no phones
create view marketing_funnel as
  select date_trunc('month', l.created_at)::date as month,
         l.source_id, l.project_id, l.stage_id,
         count(*) as leads,
         count(*) filter (where l.first_contacted_at is not null) as contacted,
         count(*) filter (where l.converted_at is not null) as converted,
         avg(extract(epoch from (l.first_contacted_at - l.created_at)) / 60.0)
           filter (where l.first_contacted_at is not null) as avg_minutes_to_first_contact
    from leads l
   where public.app_current_role() in ('admin', 'manager', 'marketing', 'viewer')
   group by 1, 2, 3, 4;

-- ================================================================ row level security
alter table teams enable row level security;
alter table profiles enable row level security;
alter table developers enable row level security;
alter table projects enable row level security;
alter table team_projects enable row level security;
alter table sources enable row level security;
alter table stages enable row level security;
alter table lost_reasons enable row level security;
alter table capture_endpoints enable row level security;
alter table people enable row level security;
alter table leads enable row level security;
alter table lead_stage_history enable row level security;
alter table enquiries enable row level security;
alter table activities enable row level security;
alter table site_visits enable row level security;
alter table calls enable row level security;
alter table bookings enable row level security;
alter table audit_log enable row level security;
alter table legacy_map enable row level security;

-- reference data: readable by any signed-in staff member, writable by admin
do $$
declare t text;
begin
  foreach t in array array['teams','developers','projects','team_projects','sources','stages','lost_reasons'] loop
    execute format('create policy %I_read on %I for select to authenticated using (public.app_current_role() is not null)', t, t);
    execute format('create policy %I_admin_write on %I for all to authenticated using (public.app_current_role() = ''admin'') with check (public.app_current_role() = ''admin'')', t, t);
  end loop;
end $$;

create policy profiles_read on profiles for select to authenticated using (
  id = auth.uid()
  or public.app_current_role() = 'admin'
  or (public.app_current_role() = 'manager' and team_id = public.app_current_team()));
create policy profiles_admin_write on profiles for all to authenticated
  using (public.app_current_role() = 'admin') with check (public.app_current_role() = 'admin');

create policy endpoints_admin on capture_endpoints for all to authenticated
  using (public.app_current_role() = 'admin') with check (public.app_current_role() = 'admin');
create policy legacy_admin on legacy_map for all to authenticated
  using (public.app_current_role() = 'admin') with check (public.app_current_role() = 'admin');
create policy audit_admin_read on audit_log for select to authenticated
  using (public.app_current_role() = 'admin');

create policy leads_read on leads for select to authenticated
  using (public.can_see_lead(assigned_to, project_id));
create policy leads_insert on leads for insert to authenticated with check (
  public.app_current_role() in ('admin', 'manager')
  or (public.app_current_role() = 'agent' and assigned_to = auth.uid()));
create policy leads_update on leads for update to authenticated
  using (public.can_see_lead(assigned_to, project_id))
  with check (public.can_see_lead(assigned_to, project_id) or public.app_current_role() in ('admin', 'manager'));
create policy leads_delete on leads for delete to authenticated
  using (public.app_current_role() = 'admin');

create policy people_read on people for select to authenticated using (
  public.app_current_role() = 'admin'
  or exists (select 1 from leads l where l.person_id = people.id));
create policy people_insert on people for insert to authenticated
  with check (public.app_current_role() in ('admin', 'manager', 'agent'));
create policy people_update on people for update to authenticated using (
  public.app_current_role() = 'admin'
  or exists (select 1 from leads l where l.person_id = people.id));

create policy stage_history_read on lead_stage_history for select to authenticated
  using (public.can_see_lead_id(lead_id));

create policy enquiries_read on enquiries for select to authenticated using (
  public.app_current_role() = 'admin'
  or (lead_id is not null and public.can_see_lead_id(lead_id)));

create policy activities_read on activities for select to authenticated
  using (assigned_to = auth.uid() or public.can_see_lead_id(lead_id));
create policy activities_insert on activities for insert to authenticated
  with check (public.can_see_lead_id(lead_id));
create policy activities_update on activities for update to authenticated
  using (assigned_to = auth.uid() or public.can_see_lead_id(lead_id));

create policy site_visits_read on site_visits for select to authenticated
  using (public.can_see_lead_id(lead_id));
create policy site_visits_write on site_visits for all to authenticated
  using (public.can_see_lead_id(lead_id)) with check (public.can_see_lead_id(lead_id));

create policy calls_read on calls for select to authenticated
  using (agent_id = auth.uid() or (lead_id is not null and public.can_see_lead_id(lead_id)));

create policy bookings_read on bookings for select to authenticated
  using (public.can_see_lead_id(lead_id));
create policy bookings_write on bookings for all to authenticated
  using (public.app_current_role() in ('admin', 'manager') and public.can_see_lead_id(lead_id))
  with check (public.app_current_role() in ('admin', 'manager') and public.can_see_lead_id(lead_id));

-- Supabase grants new objects to anon by default; lock the views and internal functions down.
revoke all on staff_directory, marketing_funnel from public, anon;
grant select on staff_directory, marketing_funnel to authenticated;
revoke all on function public.pick_assignee(uuid) from public, anon, authenticated;
grant execute on function public.pick_assignee(uuid) to service_role;
