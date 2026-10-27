-- Relive CRM 0003: the day-to-day workflows found in the Cratio review (21 Oct 2026).
-- Manual lead entry, full lead fields, tasks, notes, untouched-lead rotation, notifications and reminders,
-- call logging from phones and the web, attendance, saved views, message templates, picklists, CSV import.

-- ================================================================ settings and picklists
create table app_settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);
insert into app_settings(key, value) values
  ('rotation', '{"enabled": true, "minutes": 30, "max_rotations": 5, "only_new_within_hours": 24, "work_start": "09:00", "work_end": "21:00"}'),
  ('reminders', '{"followup_minutes": 15, "task_minutes": 30}');

create table picklist_values (
  id uuid primary key default gen_random_uuid(),
  list text not null check (list in ('priority', 'budget', 'unit_size', 'possession', 'location', 'task_category', 'call_outcome', 'lead_type')),
  value text not null,
  position int not null default 0,
  active boolean not null default true,
  unique (list, value)
);
insert into picklist_values(list, value, position) values
  ('priority', 'High', 1), ('priority', 'Medium', 2), ('priority', 'Low', 3),
  ('budget', 'Under 50 L', 1), ('budget', '50 L to 1 Cr', 2), ('budget', '1 Cr to 2 Cr', 3), ('budget', '2 Cr to 5 Cr', 4), ('budget', 'Above 5 Cr', 5),
  ('unit_size', 'Studio', 1), ('unit_size', '1 BHK', 2), ('unit_size', '2 BHK', 3), ('unit_size', '3 BHK', 4), ('unit_size', '4 BHK', 5),
  ('unit_size', 'Villa', 6), ('unit_size', 'Plot', 7), ('unit_size', 'Shop', 8), ('unit_size', 'Office', 9),
  ('possession', 'Ready to move', 1), ('possession', 'Within 1 year', 2), ('possession', '1 to 3 years', 3), ('possession', 'Any', 4),
  ('location', 'Gomti Nagar', 1), ('location', 'Gomti Nagar Extension', 2), ('location', 'Sushant Golf City', 3),
  ('location', 'Shaheed Path', 4), ('location', 'Vibhuti Khand', 5), ('location', 'Amausi', 6), ('location', 'Noida', 7),
  ('task_category', 'Call back', 1), ('task_category', 'Send details', 2), ('task_category', 'Site visit', 3),
  ('task_category', 'Meeting', 4), ('task_category', 'Documents', 5), ('task_category', 'Other', 6),
  ('call_outcome', 'Connected, interested', 1), ('call_outcome', 'Connected, call later', 2),
  ('call_outcome', 'Connected, not interested', 3), ('call_outcome', 'No answer', 4), ('call_outcome', 'Busy', 5),
  ('call_outcome', 'Switched off', 6), ('call_outcome', 'Wrong number', 7),
  ('lead_type', 'End user', 1), ('lead_type', 'Investor', 2), ('lead_type', 'Broker', 3), ('lead_type', 'NRI', 4);

-- ================================================================ more fields
alter table people
  add column company text,
  add column designation text,
  add column street text,
  add column state text,
  add column pincode text,
  add column country text,
  add column birthday date,
  add column anniversary date,
  add column spouse_birthday date;

alter table leads
  add column priority text not null default 'Medium',
  add column lead_type text,
  add column budget_band text,
  add column description text,
  add column created_by uuid,
  add column assigned_at timestamptz,
  add column rotation_count int not null default 0,
  add column followup_reminded_at timestamptz;
update leads set assigned_at = created_at where assigned_to is not null;
create index leads_rotation_idx on leads(assigned_at) where first_contacted_at is null;

alter table calls
  add column phone_e164 text,
  add column outcome text,
  add column notes text,
  add column device text;
create index calls_lead_idx on calls(lead_id, started_at);
create index calls_phone_idx on calls(phone_e164);

-- ================================================================ assignment history
create table lead_assignments (
  id bigint generated always as identity primary key,
  lead_id uuid not null references leads(id) on delete cascade,
  from_user uuid references profiles(id),
  to_user uuid references profiles(id),
  reason text not null check (reason in ('capture', 'create', 'manual', 'rotation', 'import')),
  changed_by uuid,
  at timestamptz not null default now()
);
create index lead_assignments_lead_idx on lead_assignments(lead_id);

-- ================================================================ tasks and notes
create table tasks (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid references leads(id) on delete cascade,
  title text not null,
  category text,
  assigned_to uuid not null references profiles(id),
  created_by uuid default auth.uid(),
  due_at timestamptz,
  status text not null default 'open' check (status in ('open', 'done')),
  completed_at timestamptz,
  comments text,
  reminded_at timestamptz,
  created_at timestamptz not null default now()
);
create index tasks_assignee_idx on tasks(assigned_to, status, due_at);
create index tasks_lead_idx on tasks(lead_id);

create table lead_notes (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references leads(id) on delete cascade,
  body text not null,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create index lead_notes_lead_idx on lead_notes(lead_id);

-- ================================================================ notifications and push
create table notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  kind text not null,
  title text not null,
  body text,
  lead_id uuid references leads(id) on delete cascade,
  task_id uuid references tasks(id) on delete cascade,
  created_at timestamptz not null default now(),
  read_at timestamptz,
  pushed_at timestamptz
);
create index notifications_user_idx on notifications(user_id, created_at desc);
create index notifications_unpushed_idx on notifications(created_at) where pushed_at is null;

create table push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references profiles(id) on delete cascade,
  kind text not null check (kind in ('web', 'expo')),
  endpoint text not null unique,
  keys jsonb,
  device text,
  created_at timestamptz not null default now()
);

-- ================================================================ attendance and location
create table attendance (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references profiles(id) on delete cascade,
  kind text not null check (kind in ('in', 'out')),
  at timestamptz not null default now(),
  lat double precision,
  lng double precision,
  accuracy_m real,
  address text,
  note text,
  device text
);
create index attendance_user_idx on attendance(user_id, at desc);

create table location_pings (
  id bigint generated always as identity primary key,
  user_id uuid not null default auth.uid() references profiles(id) on delete cascade,
  at timestamptz not null default now(),
  lat double precision not null,
  lng double precision not null,
  accuracy_m real
);
create index location_pings_user_idx on location_pings(user_id, at);

-- ================================================================ views, templates, imports
create table saved_views (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references profiles(id) on delete cascade,
  name text not null,
  is_public boolean not null default false,
  params jsonb not null default '{}',
  columns text[],
  created_at timestamptz not null default now()
);

create table message_templates (
  id uuid primary key default gen_random_uuid(),
  channel text not null check (channel in ('whatsapp', 'email', 'sms')),
  name text not null,
  subject text,
  body text not null,
  active boolean not null default true,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);
insert into message_templates(channel, name, subject, body) values
  ('whatsapp', 'First contact', null, 'Hello {{name}}, this is {{agent}} from Relive Solutions. Thank you for your interest in {{project}}. When is a good time to talk?'),
  ('whatsapp', 'Site visit reminder', null, 'Hello {{name}}, a reminder of your site visit for {{project}}. I will share the location shortly. {{agent}}, Relive Solutions, {{agent_phone}}'),
  ('whatsapp', 'Could not reach you', null, 'Hello {{name}}, I tried calling you about {{project}}. Please reply with a convenient time. {{agent}}, Relive Solutions'),
  ('email', 'Thank you', 'Thank you from Relive Solutions', E'Dear {{name}},\n\nThank you for your interest in {{project}}. Our executive will reach you shortly.\n\nFor assistance:\n{{agent}}\n{{agent_phone}}\n\nRegards,\nRelive Solutions Pvt Ltd');

create table import_batches (
  id uuid primary key default gen_random_uuid(),
  created_by uuid default auth.uid(),
  file_name text,
  total int not null default 0,
  inserted int not null default 0,
  updated int not null default 0,
  skipped int not null default 0,
  failed int not null default 0,
  errors jsonb not null default '[]',
  created_at timestamptz not null default now()
);

-- ================================================================ functions
-- round robin excluding one person (used by rotation)
create or replace function public.pick_assignee_except(p_team uuid, p_except uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare v uuid;
begin
  if p_team is null then return null; end if;
  select id into v from profiles
   where team_id = p_team and role = 'agent' and active and accepting_leads and id is distinct from p_except
   order by last_assigned_at nulls first, created_at
   limit 1 for update skip locked;
  if v is not null then update profiles set last_assigned_at = clock_timestamp() where id = v; end if;
  return v;
end $$;

create or replace function public.notify(p_user uuid, p_kind text, p_title text, p_body text, p_lead uuid default null, p_task uuid default null)
returns void language sql security definer set search_path = public as $$
  insert into notifications(user_id, kind, title, body, lead_id, task_id)
  select p_user, p_kind, p_title, p_body, p_lead, p_task
   where p_user is not null and exists (select 1 from profiles where id = p_user and active);
$$;

create or replace function public.lead_label(p_lead uuid) returns text
language sql stable security definer set search_path = public as $$
  select coalesce(pe.full_name, pe.phone_e164) || coalesce(' · ' || pr.name, '')
    from leads l join people pe on pe.id = l.person_id left join projects pr on pr.id = l.project_id
   where l.id = p_lead
$$;

-- Replaces 0001's version: same rules, plus assignment time and reminder reset.
create or replace function public.leads_before_update() returns trigger
language plpgsql security definer set search_path = public as $$
declare k stage_kind; r app_role;
begin
  r := public.app_current_role();
  if auth.uid() is not null and new.assigned_to is distinct from old.assigned_to
     and coalesce(r::text, '') not in ('admin', 'manager') then
    raise exception 'only managers or admins can reassign leads';
  end if;
  if new.assigned_to is distinct from old.assigned_to then
    new.assigned_at := case when new.assigned_to is null then null else now() end;
  end if;
  if new.next_followup_at is distinct from old.next_followup_at then
    new.followup_reminded_at := null;
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

create or replace function public.leads_before_insert() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.assigned_to is not null then new.assigned_at := coalesce(new.assigned_at, now()); end if;
  new.created_by := coalesce(new.created_by, auth.uid());
  return new;
end $$;
create trigger leads_before_insert before insert on leads
  for each row execute function public.leads_before_insert();

create or replace function public.leads_assignment_log() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_reason text;
begin
  v_reason := nullif(current_setting('app.assign_reason', true), '');
  if tg_op = 'INSERT' then
    if new.assigned_to is not null then
      insert into lead_assignments(lead_id, from_user, to_user, reason, changed_by)
      values (new.id, null, new.assigned_to, coalesce(v_reason, case when auth.uid() is null then 'capture' else 'create' end), auth.uid());
    end if;
  elsif new.assigned_to is distinct from old.assigned_to then
    insert into lead_assignments(lead_id, from_user, to_user, reason, changed_by)
    values (new.id, old.assigned_to, new.assigned_to, coalesce(v_reason, 'manual'), auth.uid());
  end if;
  return null;
end $$;
create trigger leads_assignment_log after insert or update on leads
  for each row execute function public.leads_assignment_log();

create or replace function public.lead_assignments_notify() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_label text := public.lead_label(new.lead_id); v_to text;
begin
  if new.to_user is not null and new.to_user is distinct from new.changed_by then
    perform public.notify(new.to_user, 'lead_assigned',
      case new.reason when 'rotation' then 'Lead passed to you (not yet called)'
                      when 'manual' then 'Lead re-assigned to you'
                      else 'New lead assigned to you' end,
      v_label, new.lead_id);
  end if;
  if new.reason = 'rotation' and new.from_user is not null then
    select full_name into v_to from profiles where id = new.to_user;
    perform public.notify(new.from_user, 'lead_rotated', 'Lead moved to ' || coalesce(v_to, 'another agent'),
      v_label || ' was not called in time', new.lead_id);
  end if;
  return null;
end $$;
create trigger lead_assignments_notify after insert on lead_assignments
  for each row execute function public.lead_assignments_notify();

create or replace function public.tasks_before_write() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'done' and (tg_op = 'INSERT' or old.status <> 'done') then new.completed_at := now(); end if;
  if new.status = 'open' then new.completed_at := null; end if;
  if tg_op = 'UPDATE' and new.due_at is distinct from old.due_at then new.reminded_at := null; end if;
  return new;
end $$;
create trigger tasks_before_write before insert or update on tasks
  for each row execute function public.tasks_before_write();

create or replace function public.tasks_after_write() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.assigned_to is distinct from auth.uid()
     and (tg_op = 'INSERT' or new.assigned_to is distinct from old.assigned_to) then
    perform public.notify(new.assigned_to, 'task_assigned', 'New task: ' || new.title,
      coalesce(public.lead_label(new.lead_id), ''), new.lead_id, new.id);
  end if;
  if new.lead_id is not null then
    update leads set last_activity_at = greatest(last_activity_at, now()) where id = new.lead_id;
  end if;
  return null;
end $$;
create trigger tasks_after_write after insert or update on tasks
  for each row execute function public.tasks_after_write();

-- Leads nobody has acted on are passed to the next agent in the team, as Cratio does every 30 minutes.
-- "Acted on" means any call, activity, note or task by the current assignee since it was assigned, or a stage change.
create or replace function public.rotate_untouched() returns int
language plpgsql security definer set search_path = public as $$
declare
  s jsonb; v_now_ist time; r record; v_next uuid; n int := 0;
begin
  select value into s from app_settings where key = 'rotation';
  if s is null or not coalesce((s ->> 'enabled')::boolean, false) then return 0; end if;
  v_now_ist := (now() at time zone 'Asia/Kolkata')::time;
  if v_now_ist < (s ->> 'work_start')::time or v_now_ist >= (s ->> 'work_end')::time then return 0; end if;

  for r in
    select l.id, l.assigned_to, p.team_id
      from leads l
      join stages st on st.id = l.stage_id and st.is_default
      join profiles p on p.id = l.assigned_to
     where l.first_contacted_at is null
       and l.assigned_at < now() - make_interval(mins => (s ->> 'minutes')::int)
       and l.rotation_count < (s ->> 'max_rotations')::int
       and l.created_at > now() - make_interval(hours => (s ->> 'only_new_within_hours')::int)
       and not exists (select 1 from activities a where a.lead_id = l.id and a.created_by = l.assigned_to and a.created_at >= l.assigned_at)
       and not exists (select 1 from calls c where c.lead_id = l.id and c.agent_id = l.assigned_to and c.created_at >= l.assigned_at)
       and not exists (select 1 from lead_notes nt where nt.lead_id = l.id and nt.created_by = l.assigned_to and nt.created_at >= l.assigned_at)
       and not exists (select 1 from tasks t where t.lead_id = l.id and t.created_by = l.assigned_to and t.created_at >= l.assigned_at)
     order by l.assigned_at
     for update of l skip locked
  loop
    v_next := public.pick_assignee_except(r.team_id, r.assigned_to);
    continue when v_next is null;
    perform set_config('app.assign_reason', 'rotation', true);
    update leads set assigned_to = v_next, rotation_count = rotation_count + 1 where id = r.id;
    n := n + 1;
  end loop;
  perform set_config('app.assign_reason', '', true);
  return n;
end $$;

-- Follow-up and task reminders become notifications (and push messages) a few minutes before they are due.
create or replace function public.queue_reminders() returns int
language plpgsql security definer set search_path = public as $$
declare s jsonb; r record; n int := 0;
begin
  select value into s from app_settings where key = 'reminders';
  for r in
    select l.id, l.assigned_to, l.next_followup_at, l.next_followup_note
      from leads l join stages st on st.id = l.stage_id and st.kind = 'open'
     where l.assigned_to is not null and l.followup_reminded_at is null
       and l.next_followup_at between now() - interval '5 minutes'
                                  and now() + make_interval(mins => coalesce((s ->> 'followup_minutes')::int, 15))
     for update of l skip locked
  loop
    perform public.notify(r.assigned_to, 'followup_due',
      'Follow-up at ' || to_char(r.next_followup_at at time zone 'Asia/Kolkata', 'HH12:MI am'),
      public.lead_label(r.id) || coalesce(' · ' || r.next_followup_note, ''), r.id);
    update leads set followup_reminded_at = now() where id = r.id;
    n := n + 1;
  end loop;
  for r in
    select t.id, t.assigned_to, t.title, t.due_at, t.lead_id from tasks t
     where t.status = 'open' and t.reminded_at is null and t.due_at is not null
       and t.due_at between now() - interval '5 minutes'
                        and now() + make_interval(mins => coalesce((s ->> 'task_minutes')::int, 30))
     for update of t skip locked
  loop
    perform public.notify(r.assigned_to, 'task_due',
      'Task due at ' || to_char(r.due_at at time zone 'Asia/Kolkata', 'HH12:MI am') || ': ' || r.title,
      coalesce(public.lead_label(r.lead_id), ''), r.lead_id, r.id);
    update tasks set reminded_at = now() where id = r.id;
    n := n + 1;
  end loop;
  return n;
end $$;

-- Manual lead entry (walk-in, reference, direct call). Never creates a duplicate: if the person already has an
-- open lead for the same project, it is marked as a re-enquiry and its owner is told.
create or replace function public.create_lead(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_role app_role := public.app_current_role(); v_uid uuid := auth.uid();
  v_phone text := public.normalize_phone(p ->> 'phone');
  v_person uuid; v_lead uuid; v_owner uuid; v_owner_name text; v_project uuid; v_stage uuid; v_assignee uuid;
begin
  if v_role is null or v_role not in ('admin', 'manager', 'agent') then
    raise exception 'not allowed to add leads' using errcode = '42501';
  end if;
  if v_phone is null then raise exception 'enter a valid mobile number' using errcode = '22023'; end if;
  v_project := nullif(p ->> 'project_id', '')::uuid;

  insert into people(phone_e164, full_name, email, alt_phone, city, company, designation)
  values (v_phone, nullif(btrim(p ->> 'full_name'), ''), nullif(btrim(p ->> 'email'), ''), public.normalize_phone(p ->> 'alt_phone'),
          nullif(btrim(p ->> 'city'), ''), nullif(btrim(p ->> 'company'), ''), nullif(btrim(p ->> 'designation'), ''))
  on conflict (phone_e164) do update set
    full_name = coalesce(people.full_name, excluded.full_name), email = coalesce(people.email, excluded.email),
    alt_phone = coalesce(people.alt_phone, excluded.alt_phone), city = coalesce(people.city, excluded.city),
    company = coalesce(people.company, excluded.company), designation = coalesce(people.designation, excluded.designation),
    updated_at = now()
  returning id into v_person;

  select l.id, l.assigned_to into v_lead, v_owner from leads l join stages s on s.id = l.stage_id
   where l.person_id = v_person and l.project_id is not distinct from v_project and s.kind = 'open'
   order by l.created_at desc limit 1;
  if v_lead is not null then
    update leads set reenquiry_count = reenquiry_count + 1, last_activity_at = now(),
                     next_followup_at = least(coalesce(next_followup_at, now()), now())
     where id = v_lead;
    insert into activities(lead_id, type, notes, created_by, completed_at)
    values (v_lead, 're_enquiry', 'Added again by ' || coalesce((select full_name from profiles where id = v_uid), 'a colleague')
            || coalesce(' (' || nullif(p ->> 'description', '') || ')', ''), v_uid, now());
    if v_owner is distinct from v_uid then
      perform public.notify(v_owner, 'reenquiry', 'Your lead enquired again', public.lead_label(v_lead), v_lead);
    end if;
    select full_name into v_owner_name from profiles where id = v_owner;
    return jsonb_build_object('status', 'exists', 'lead_id', v_lead, 'owner', v_owner_name,
                              'visible', public.can_see_lead_id(v_lead));
  end if;

  v_stage := coalesce(nullif(p ->> 'stage_id', '')::uuid, (select id from stages where is_default));
  v_assignee := case when v_role = 'agent' then v_uid
                     else coalesce(nullif(p ->> 'assigned_to', '')::uuid,
                                   case when coalesce((p ->> 'round_robin')::boolean, false)
                                        then public.pick_assignee(coalesce(nullif(p ->> 'team_id', '')::uuid, public.app_current_team())) end,
                                   v_uid) end;
  insert into leads(person_id, project_id, source_id, stage_id, assigned_to, temperature, priority, lead_type, budget_band,
                    budget_min, budget_max, unit_size, possession_pref, location_pref, description,
                    next_followup_at, next_followup_note)
  values (v_person, v_project, nullif(p ->> 'source_id', '')::uuid, v_stage, v_assignee,
          coalesce(nullif(p ->> 'temperature', ''), 'warm')::temperature, coalesce(nullif(p ->> 'priority', ''), 'Medium'),
          nullif(p ->> 'lead_type', ''), nullif(p ->> 'budget_band', ''), nullif(p ->> 'budget_min', '')::numeric, nullif(p ->> 'budget_max', '')::numeric,
          nullif(p ->> 'unit_size', ''), nullif(p ->> 'possession_pref', ''), nullif(p ->> 'location_pref', ''),
          nullif(p ->> 'description', ''), coalesce(nullif(p ->> 'next_followup_at', '')::timestamptz, now()),
          nullif(p ->> 'next_followup_note', ''))
  returning id into v_lead;
  return jsonb_build_object('status', 'created', 'lead_id', v_lead);
end $$;

-- One call from a phone (Android call log sync, iOS or web after-call form). Matches the number to a person and
-- the caller's lead. Safe to send twice: a repeat of the same device call id is ignored.
create or replace function public.log_call(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid(); v_role app_role := public.app_current_role();
  v_phone text := public.normalize_phone(p ->> 'phone');
  v_person uuid; v_lead uuid := nullif(p ->> 'lead_id', '')::uuid; v_call uuid;
  v_started timestamptz := coalesce(nullif(p ->> 'started_at', '')::timestamptz, now());
  v_dur int := greatest(0, coalesce(nullif(p ->> 'duration_seconds', '')::int, 0));
  v_dir call_direction := coalesce(nullif(p ->> 'direction', ''), 'outgoing')::call_direction;
  v_status call_status;
begin
  if v_role is null or v_role not in ('admin', 'manager', 'agent') then
    raise exception 'not allowed to log calls' using errcode = '42501';
  end if;
  v_status := coalesce(nullif(p ->> 'status', '')::call_status,
                       case when v_dur > 0 then 'connected' when v_dir = 'incoming' then 'missed' else 'not_connected' end::call_status);
  if v_lead is not null and not public.can_see_lead_id(v_lead) then v_lead := null; end if;
  if v_lead is not null then
    select person_id into v_person from leads where id = v_lead;
    select phone_e164 into v_phone from people where id = v_person;
  elsif v_phone is not null then
    select id into v_person from people where phone_e164 = v_phone;
    if v_person is not null then
      select l.id into v_lead from leads l join stages s on s.id = l.stage_id
       where l.person_id = v_person and public.can_see_lead(l.assigned_to, l.project_id)
       order by (l.assigned_to = v_uid) desc, (s.kind = 'open') desc, l.last_activity_at desc limit 1;
    end if;
  end if;

  insert into calls(person_id, lead_id, agent_id, direction, status, started_at, ended_at, duration_seconds,
                    provider, provider_call_id, recording_path, phone_e164, outcome, notes, device, raw)
  values (v_person, v_lead, v_uid, v_dir, v_status, v_started, v_started + make_interval(secs => v_dur), v_dur,
          coalesce(nullif(p ->> 'provider', ''), 'manual'), nullif(p ->> 'device_call_id', ''), nullif(p ->> 'recording_path', ''),
          coalesce(v_phone, nullif(p ->> 'phone', '')), nullif(p ->> 'outcome', ''), nullif(p ->> 'notes', ''), nullif(p ->> 'device', ''), p)
  on conflict (provider, provider_call_id) do nothing
  returning id into v_call;
  if v_call is null then
    return jsonb_build_object('status', 'duplicate', 'lead_id', v_lead);
  end if;
  if v_lead is not null then
    update leads set last_activity_at = greatest(last_activity_at, v_started),
                     first_contacted_at = case when v_dir = 'outgoing' or v_status = 'connected'
                                               then coalesce(first_contacted_at, v_started) else first_contacted_at end
     where id = v_lead;
  end if;
  return jsonb_build_object('status', 'logged', 'call_id', v_call, 'lead_id', v_lead, 'person_id', v_person,
                            'matched', v_lead is not null);
end $$;

create or replace function public.log_calls(p_calls jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare c jsonb; r jsonb; logged int := 0; dup int := 0; matched int := 0;
begin
  for c in select * from jsonb_array_elements(coalesce(p_calls, '[]'::jsonb)) loop
    r := public.log_call(c);
    if r ->> 'status' = 'logged' then logged := logged + 1; else dup := dup + 1; end if;
    if (r ->> 'lead_id') is not null and r ->> 'status' = 'logged' then matched := matched + 1; end if;
  end loop;
  return jsonb_build_object('logged', logged, 'duplicates', dup, 'matched', matched);
end $$;

-- CSV import (rows already parsed by the app). Admins and managers only. Looks up project, source and stage by
-- name, assigns by owner email or round robin, records a batch with row-level errors.
create or replace function public.import_leads(p_rows jsonb, p_options jsonb default '{}') returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_role app_role := public.app_current_role();
  row_ jsonb; i int := 0; v_phone text; v_person uuid; v_lead uuid; v_project uuid; v_source uuid; v_stage uuid; v_assignee uuid;
  v_ins int := 0; v_upd int := 0; v_skip int := 0; v_fail int := 0; v_errors jsonb := '[]'; v_batch uuid;
  v_dupe text := coalesce(p_options ->> 'on_duplicate', 'skip');
  v_team uuid := nullif(p_options ->> 'team_id', '')::uuid;
  v_kind stage_kind; v_lost uuid;
begin
  if v_role is null or v_role not in ('admin', 'manager') then
    raise exception 'only admins and managers can import' using errcode = '42501';
  end if;
  perform set_config('app.assign_reason', 'import', true);
  for row_ in select * from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) loop
    i := i + 1;
    begin
      v_phone := public.normalize_phone(row_ ->> 'phone');
      if v_phone is null then raise exception 'invalid mobile number %', coalesce(row_ ->> 'phone', '(blank)'); end if;
      v_project := (select id from projects where lower(name) = lower(btrim(row_ ->> 'project')));
      if v_project is null and nullif(btrim(row_ ->> 'project'), '') is not null then
        if v_role = 'admin' and coalesce((p_options ->> 'create_missing')::boolean, false) then
          insert into projects(name) values (btrim(row_ ->> 'project')) returning id into v_project;
        else raise exception 'unknown project %', row_ ->> 'project'; end if;
      end if;
      v_source := (select id from sources where lower(name) = lower(btrim(row_ ->> 'source')));
      if v_source is null and nullif(btrim(row_ ->> 'source'), '') is not null then
        if v_role = 'admin' then insert into sources(name) values (btrim(row_ ->> 'source')) returning id into v_source;
        else raise exception 'unknown source %', row_ ->> 'source'; end if;
      end if;
      v_stage := coalesce((select id from stages where lower(name) = lower(btrim(row_ ->> 'stage'))), (select id from stages where is_default));
      select kind into v_kind from stages where id = v_stage;
      v_lost := case when v_kind = 'lost' then coalesce((select id from lost_reasons where lower(name) = lower(btrim(row_ ->> 'lost_reason'))),
                                                       (select id from lost_reasons where name = 'Other')) end;

      insert into people(phone_e164, full_name, email, city, alt_phone, company)
      values (v_phone, nullif(btrim(row_ ->> 'name'), ''), nullif(btrim(row_ ->> 'email'), ''), nullif(btrim(row_ ->> 'city'), ''),
              public.normalize_phone(row_ ->> 'alt_phone'), nullif(btrim(row_ ->> 'company'), ''))
      on conflict (phone_e164) do update set
        full_name = coalesce(people.full_name, excluded.full_name), email = coalesce(people.email, excluded.email),
        city = coalesce(people.city, excluded.city), alt_phone = coalesce(people.alt_phone, excluded.alt_phone),
        company = coalesce(people.company, excluded.company), updated_at = now()
      returning id into v_person;

      select l.id into v_lead from leads l where l.person_id = v_person and l.project_id is not distinct from v_project
       order by l.created_at desc limit 1;
      if v_lead is not null then
        if v_dupe = 'update' then
          update leads set
            stage_id = v_stage, lost_reason_id = coalesce(v_lost, lost_reason_id),
            priority = coalesce(nullif(row_ ->> 'priority', ''), priority),
            description = coalesce(nullif(row_ ->> 'notes', ''), description),
            next_followup_at = coalesce(nullif(row_ ->> 'next_followup_at', '')::timestamptz, next_followup_at)
           where id = v_lead;
          v_upd := v_upd + 1;
        else v_skip := v_skip + 1; end if;
      else
        v_assignee := (select p.id from profiles p join auth.users u on u.id = p.id
                        where lower(u.email) = lower(btrim(row_ ->> 'owner_email')) and p.active);
        if v_assignee is null and nullif(btrim(row_ ->> 'owner_name'), '') is not null then
          v_assignee := (select id from profiles where lower(full_name) = lower(btrim(row_ ->> 'owner_name')) and active limit 1);
        end if;
        if v_assignee is null and v_team is not null then v_assignee := public.pick_assignee(v_team); end if;
        insert into leads(person_id, project_id, source_id, stage_id, assigned_to, priority, temperature, description,
                          lost_reason_id, next_followup_at, created_at, first_contacted_at, budget_band, unit_size, location_pref, next_followup_note)
        values (v_person, v_project, v_source, v_stage, v_assignee, coalesce(nullif(row_ ->> 'priority', ''), 'Medium'),
                coalesce(nullif(lower(row_ ->> 'temperature'), ''), 'warm')::temperature, nullif(row_ ->> 'notes', ''),
                v_lost, nullif(row_ ->> 'next_followup_at', '')::timestamptz,
                coalesce(nullif(row_ ->> 'created_at', '')::timestamptz, now()),
                case when v_kind <> 'open' or (select position from stages where id = v_stage) > 1
                     then coalesce(nullif(row_ ->> 'created_at', '')::timestamptz, now()) end,
                nullif(row_ ->> 'budget', ''), nullif(row_ ->> 'unit_size', ''), nullif(row_ ->> 'location', ''),
                nullif(row_ ->> 'next_followup_note', ''))
        returning id into v_lead;
        if nullif(row_ ->> 'legacy_id', '') is not null then
          insert into legacy_map(entity, legacy_id, new_id) values ('lead', row_ ->> 'legacy_id', v_lead)
          on conflict do nothing;
        end if;
        v_ins := v_ins + 1;
      end if;
    exception when others then
      v_fail := v_fail + 1;
      v_errors := v_errors || jsonb_build_object('row', i, 'error', sqlerrm);
    end;
  end loop;
  perform set_config('app.assign_reason', '', true);
  insert into import_batches(file_name, total, inserted, updated, skipped, failed, errors)
  values (p_options ->> 'file_name', i, v_ins, v_upd, v_skip, v_fail, v_errors) returning id into v_batch;
  return jsonb_build_object('batch_id', v_batch, 'total', i, 'inserted', v_ins, 'updated', v_upd,
                            'skipped', v_skip, 'failed', v_fail, 'errors', v_errors);
end $$;

-- The Android app uploads the dialer's recording after syncing a call, then links it here.
create or replace function public.attach_recording(p_device_call_id text, p_path text) returns boolean
language sql security definer set search_path = public as $$
  with u as (
    update calls set recording_path = p_path
     where provider = 'android' and provider_call_id = p_device_call_id and agent_id = auth.uid()
    returning 1)
  select exists (select 1 from u)
$$;

create or replace function public.mark_notifications_read(p_ids uuid[] default null) returns int
language sql security definer set search_path = public as $$
  with u as (
    update notifications set read_at = now()
     where user_id = auth.uid() and read_at is null and (p_ids is null or id = any(p_ids))
    returning 1)
  select count(*)::int from u
$$;

-- ================================================================ row level security
alter table app_settings enable row level security;
alter table picklist_values enable row level security;
alter table lead_assignments enable row level security;
alter table tasks enable row level security;
alter table lead_notes enable row level security;
alter table notifications enable row level security;
alter table push_subscriptions enable row level security;
alter table attendance enable row level security;
alter table location_pings enable row level security;
alter table saved_views enable row level security;
alter table message_templates enable row level security;
alter table import_batches enable row level security;

create policy settings_read on app_settings for select to authenticated using (public.app_current_role() is not null);
create policy settings_admin on app_settings for all to authenticated
  using (public.app_current_role() = 'admin') with check (public.app_current_role() = 'admin');
create policy picklist_read on picklist_values for select to authenticated using (public.app_current_role() is not null);
create policy picklist_admin on picklist_values for all to authenticated
  using (public.app_current_role() = 'admin') with check (public.app_current_role() = 'admin');

create policy lead_assignments_read on lead_assignments for select to authenticated using (public.can_see_lead_id(lead_id));

-- a manager sees and manages the tasks of people in their team
create or replace function public.in_my_team(p_user uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.app_current_role() = 'admin'
      or (public.app_current_role() = 'manager' and exists (
            select 1 from profiles where id = p_user and team_id = public.app_current_team()))
$$;
create policy tasks_read on tasks for select to authenticated using (
  assigned_to = auth.uid() or created_by = auth.uid() or public.in_my_team(assigned_to)
  or (lead_id is not null and public.can_see_lead_id(lead_id)));
create policy tasks_insert on tasks for insert to authenticated with check (
  public.app_current_role() in ('admin', 'manager', 'agent')
  and (lead_id is null or public.can_see_lead_id(lead_id))
  and (assigned_to = auth.uid() or public.in_my_team(assigned_to)));
create policy tasks_update on tasks for update to authenticated using (
  assigned_to = auth.uid() or created_by = auth.uid() or public.in_my_team(assigned_to))
  with check (assigned_to = auth.uid() or created_by = auth.uid() or public.in_my_team(assigned_to));
create policy tasks_delete on tasks for delete to authenticated using (
  created_by = auth.uid() or public.app_current_role() = 'admin');

create policy notes_read on lead_notes for select to authenticated using (public.can_see_lead_id(lead_id));
create policy notes_insert on lead_notes for insert to authenticated
  with check (public.can_see_lead_id(lead_id) and created_by = auth.uid());
create policy notes_delete on lead_notes for delete to authenticated
  using (created_by = auth.uid() or public.app_current_role() = 'admin');

create policy notifications_own on notifications for select to authenticated using (user_id = auth.uid());
create policy notifications_own_update on notifications for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy push_own on push_subscriptions for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy attendance_insert on attendance for insert to authenticated
  with check (user_id = auth.uid() and public.app_current_role() is not null);
create policy attendance_read on attendance for select to authenticated
  using (user_id = auth.uid() or public.in_my_team(user_id));
create policy pings_insert on location_pings for insert to authenticated
  with check (user_id = auth.uid() and public.app_current_role() is not null);
create policy pings_read on location_pings for select to authenticated
  using (user_id = auth.uid() or public.in_my_team(user_id));

create policy views_read on saved_views for select to authenticated
  using (owner_id = auth.uid() or (is_public and public.app_current_role() is not null));
create policy views_write on saved_views for all to authenticated
  using (owner_id = auth.uid() or public.app_current_role() = 'admin')
  with check (owner_id = auth.uid() or public.app_current_role() = 'admin');

create policy templates_read on message_templates for select to authenticated using (public.app_current_role() is not null);
create policy templates_write on message_templates for all to authenticated
  using (public.app_current_role() in ('admin', 'manager')) with check (public.app_current_role() in ('admin', 'manager'));

create policy imports_read on import_batches for select to authenticated
  using (created_by = auth.uid() or public.app_current_role() = 'admin');

-- agents may update people on their own leads (edit form); 0001 already allows this through people_update.

-- ================================================================ grants
revoke all on function public.rotate_untouched(), public.queue_reminders(),
  public.pick_assignee_except(uuid, uuid), public.notify(uuid, text, text, text, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.rotate_untouched(), public.queue_reminders() to service_role;
revoke all on function public.create_lead(jsonb), public.log_call(jsonb), public.log_calls(jsonb), public.attach_recording(text, text),
  public.import_leads(jsonb, jsonb), public.mark_notifications_read(uuid[]) from public, anon;
grant execute on function public.create_lead(jsonb), public.log_call(jsonb), public.log_calls(jsonb), public.attach_recording(text, text),
  public.import_leads(jsonb, jsonb), public.mark_notifications_read(uuid[]) to authenticated;
