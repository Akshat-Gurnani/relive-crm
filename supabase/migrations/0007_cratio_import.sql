-- Relive CRM 0007: what the Cratio export showed the CRM was missing, plus a repeatable Cratio import.
--   Lead fields Cratio has and the CRM lacked: qualification (Qualified / Non-qualified / Diverted),
--   property type, BHK, other projects and interests the person asked about, list tags (HNI, Associate...),
--   and the untouched Cratio values kept for reference (legacy).
--   Lost reasons Cratio uses: Wrong client segment, Wrong info, Pricing issue.
--   A bulk import never sends "new lead assigned" alerts and is never auto-rotated.

alter table leads
  add column qualification text check (qualification in ('Qualified', 'Non-qualified', 'Diverted')),
  add column property_type text,
  add column bhk text,
  add column interests text[] not null default '{}',
  add column tags text[] not null default '{}',
  add column legacy jsonb,
  add column import_ref text;
create unique index leads_import_ref_uniq on leads(import_ref) where import_ref is not null;
create index leads_tags_idx on leads using gin(tags);
create index leads_interests_idx on leads using gin(interests);
create index leads_qualification_idx on leads(qualification) where qualification is not null;

insert into lost_reasons(name) values ('Wrong client segment'), ('Wrong info'), ('Pricing issue')
on conflict (name) do nothing;

-- picklists: the values Relive actually uses in Cratio
alter table picklist_values drop constraint picklist_values_list_check;
alter table picklist_values add constraint picklist_values_list_check check (list in
  ('priority', 'budget', 'unit_size', 'possession', 'location', 'task_category', 'call_outcome', 'lead_type',
   'property_type', 'bhk', 'lead_tag', 'interest'));
insert into picklist_values(list, value, position) values
  ('budget', '0-20 Lac', 11), ('budget', '20-40 Lac', 12), ('budget', '40-60 Lac', 13), ('budget', '60-80 Lac', 14),
  ('budget', '80-1 Cr', 15), ('budget', '1Cr-1.5Cr', 16), ('budget', '1.5Cr-2Cr', 17),
  ('unit_size', '200 SQ FT-500 SQFT', 21), ('unit_size', '500 SQ FT-1000 SQFT', 22), ('unit_size', '1000 SQFT-1500 SQFT', 23),
  ('unit_size', '1500 SQ FT-2000 SQFT', 24), ('unit_size', '2000 SQ FT-3000 SQFT', 25), ('unit_size', '3000 SQFT- 4000 SQFT', 26),
  ('possession', 'Under Construction', 11), ('possession', 'Ready to Move-In', 12),
  ('location', 'Sultanpur Road', 21), ('location', 'Raebareli Road', 22), ('location', 'Faizabad Road', 23),
  ('location', 'Kanpur Road', 24), ('location', 'Sitapur Road', 25),
  ('lead_type', 'Meta', 11), ('lead_type', 'Website traffic', 12),
  ('property_type', 'Flat', 1), ('property_type', 'Plot', 2), ('property_type', 'Villa', 3), ('property_type', 'Commercial Shop', 4),
  ('property_type', 'Commercial Office Space', 5), ('property_type', 'Commercial Plot', 6), ('property_type', 'Virtual Shop', 7),
  ('property_type', 'Virtual Office Space', 8),
  ('bhk', '1 BHK', 1), ('bhk', '2 BHK', 2), ('bhk', '3 BHK', 3), ('bhk', '4 BHK', 4),
  ('lead_tag', 'HNI', 1), ('lead_tag', 'Associate', 2), ('lead_tag', 'Raw data', 3), ('lead_tag', 'YTT', 4), ('lead_tag', 'Demo', 5),
  ('interest', 'Residential', 1), ('interest', 'Commercial', 2), ('interest', 'Plot', 3), ('interest', 'Investment', 4)
on conflict (list, value) do nothing;

-- a bulk import is history, not news: nobody is alerted for it
create or replace function public.lead_assignments_notify() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_label text; v_to text;
begin
  if new.reason = 'import' then return null; end if;
  v_label := public.lead_label(new.lead_id);
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

-- a call only touches the lead when it changes something (no needless "updated" bumps, e.g. on a call-log import)
create or replace function public.calls_after_insert() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.lead_id is not null and new.direction = 'outgoing' then
    update leads set first_contacted_at = coalesce(first_contacted_at, new.started_at),
                     last_activity_at = greatest(last_activity_at, new.started_at)
     where id = new.lead_id and (first_contacted_at is null or last_activity_at < new.started_at);
  end if;
  return null;
end $$;

-- ================================================================ staging: cleaned rows uploaded by an admin
create table import_rows (
  batch text not null,
  n int not null,
  data jsonb not null,
  created_at timestamptz not null default now(),
  primary key (batch, n)
);
alter table import_rows enable row level security;
create policy import_rows_admin on import_rows for all to authenticated
  using (public.app_current_role() = 'admin') with check (public.app_current_role() = 'admin');

-- Upload with a one-time key (for a script, no staff password needed). An admin creates the key in SQL:
--   insert into private.import_tokens(hash, batch, expires_at) values (encode(sha256('<key>'::bytea), 'hex'), '<batch>', now() + interval '2 hours');
create table private.import_tokens (
  hash text primary key,
  batch text not null,
  expires_at timestamptz not null
);
create or replace function public.import_rows_put(p_token text, p_batch text, p_rows jsonb) returns int
language plpgsql security definer set search_path = public as $$
declare v_n int;
begin
  if not exists (select 1 from private.import_tokens t where t.hash = encode(sha256(convert_to(p_token, 'UTF8')), 'hex')
                  and t.batch = p_batch and t.expires_at > now()) then
    raise exception 'invalid or expired import key' using errcode = '28000';
  end if;
  insert into import_rows(batch, n, data)
  select p_batch, (e ->> 'n')::int, e from jsonb_array_elements(p_rows) e
  on conflict (batch, n) do nothing;
  get diagnostics v_n = row_count;
  return v_n;
end $$;
revoke all on function public.import_rows_put(text, text, jsonb) from public;
grant execute on function public.import_rows_put(text, text, jsonb) to anon, authenticated;

-- Turns one uploaded batch into people, leads, calls, site visits and notes. Staff must already exist as profiles
-- (matched by full name, any case). Safe to re-run: rows already imported (same batch and row number) are skipped.
create or replace function private.import_cratio(p_batch text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_missing text[]; v_leads int; v_calls int; v_visits int; v_notes int; v_people int; v_invalid int;
begin
  select array_agg(distinct v.x) into v_missing
    from import_rows r,
         lateral (values (r.data ->> 'assigned_to'), (r.data ->> 'created_by'), (r.data ->> 'updated_by'), (r.data #>> '{call,agent}')) v(x)
   where r.batch = p_batch and v.x is not null
     and not exists (select 1 from profiles p where lower(p.full_name) = lower(v.x));
  if v_missing is not null then
    raise exception 'create these staff first: %', array_to_string(v_missing, ', ');
  end if;

  insert into sources(name) select distinct data ->> 'source' from import_rows where batch = p_batch and data ? 'source'
  on conflict (name) do nothing;
  insert into vendors(name) select distinct data ->> 'vendor' from import_rows where batch = p_batch and data ->> 'vendor' is not null
  on conflict (name) do nothing;
  insert into projects(name) select distinct data ->> 'project' from import_rows where batch = p_batch and data ->> 'project' is not null
  on conflict (name) do nothing;
  insert into lost_reasons(name) select distinct data ->> 'lost_reason' from import_rows where batch = p_batch and data ->> 'lost_reason' is not null
  on conflict (name) do nothing;

  with ins as (
    insert into people(phone_e164, full_name, email, alt_phone, city, street, state, pincode, country, birthday, spouse_birthday)
    select public.normalize_phone(d ->> 'phone'), d ->> 'name', d ->> 'email', public.normalize_phone(d ->> 'alt_phone'), d ->> 'city',
           d ->> 'street', d ->> 'state', d ->> 'pincode', d ->> 'country', (d ->> 'birthday')::date, (d ->> 'spouse_birthday')::date
      from (select distinct on (public.normalize_phone(data ->> 'phone')) data d from import_rows where batch = p_batch order by public.normalize_phone(data ->> 'phone'), n) s
     where public.normalize_phone(d ->> 'phone') is not null
    on conflict (phone_e164) do update set
      full_name = coalesce(people.full_name, excluded.full_name), email = coalesce(people.email, excluded.email),
      alt_phone = coalesce(people.alt_phone, excluded.alt_phone), city = coalesce(people.city, excluded.city),
      street = coalesce(people.street, excluded.street), state = coalesce(people.state, excluded.state),
      pincode = coalesce(people.pincode, excluded.pincode), country = coalesce(people.country, excluded.country),
      birthday = coalesce(people.birthday, excluded.birthday), spouse_birthday = coalesce(people.spouse_birthday, excluded.spouse_birthday)
    returning 1)
  select count(*) into v_people from ins;

  perform set_config('app.assign_reason', 'import', true);
  with ins as (
    insert into leads(person_id, project_id, source_id, vendor_id, provider, campaign_name, stage_id, temperature, priority,
                      lead_type, qualification, budget_band, property_type, bhk, unit_size, location_pref, possession_pref,
                      description, interests, tags, assigned_to, assigned_at, first_contacted_at, next_followup_at,
                      lost_reason_id, lost_remarks, lost_at, converted_at, created_by, created_at, updated_at,
                      stage_changed_at, last_activity_at, rotation_count, legacy, import_ref)
    select pe.id, pr.id, so.id, ve.id, d ->> 'provider', d ->> 'campaign', st.id, (d ->> 'temperature')::temperature,
           coalesce(d ->> 'priority', 'Medium'), d ->> 'lead_type', d ->> 'qualification', d ->> 'budget_band',
           d ->> 'property_type', d ->> 'bhk', d ->> 'unit_size', d ->> 'location_pref', d ->> 'possession_pref',
           d ->> 'description',
           coalesce(array(select jsonb_array_elements_text(d -> 'interests')), '{}'),
           coalesce(array(select jsonb_array_elements_text(d -> 'tags')), '{}'),
           ag.id, coalesce((d ->> 'assigned_at')::timestamptz, (d ->> 'created_at')::timestamptz), (d ->> 'first_contacted_at')::timestamptz, (d ->> 'next_followup_at')::timestamptz,
           lr.id, d ->> 'lost_remarks', (d ->> 'lost_at')::timestamptz, (d ->> 'converted_at')::timestamptz,
           cb.id, (d ->> 'created_at')::timestamptz, coalesce((d ->> 'updated_at')::timestamptz, (d ->> 'created_at')::timestamptz),
           coalesce((d ->> 'lost_at')::timestamptz, (d ->> 'converted_at')::timestamptz, (d ->> 'updated_at')::timestamptz, (d ->> 'created_at')::timestamptz),
           (d ->> 'last_activity_at')::timestamptz,
           99,  -- never auto-rotated: the Cratio owner stays until someone reassigns
           d -> 'legacy', p_batch || ':' || r.n
      from import_rows r
      cross join lateral (select r.data as d) x
      join people pe on pe.phone_e164 = public.normalize_phone(d ->> 'phone')
      join stages st on st.name = d ->> 'stage'
      left join projects pr on pr.name = d ->> 'project'
      left join sources so on so.name = d ->> 'source'
      left join vendors ve on ve.name = d ->> 'vendor'
      left join lost_reasons lr on lr.name = d ->> 'lost_reason'
      left join lateral (select id from profiles where lower(full_name) = lower(d ->> 'assigned_to') limit 1) ag on true
      left join lateral (select id from profiles where lower(full_name) = lower(d ->> 'created_by') limit 1) cb on true
     where r.batch = p_batch and r.n > 0
    on conflict (import_ref) where import_ref is not null do nothing
    returning id, created_at, stage_changed_at, assigned_at)
  select count(*) into v_leads from ins;

  -- history rows written by the triggers get Cratio's dates, not today's
  update lead_stage_history h set changed_at = l.stage_changed_at, changed_by = l.created_by
    from leads l where h.lead_id = l.id and l.import_ref like p_batch || ':%' and h.from_stage_id is null and h.changed_at > l.stage_changed_at;
  update lead_assignments a set at = coalesce(l.assigned_at, l.created_at)
    from leads l where a.lead_id = l.id and l.import_ref like p_batch || ':%' and a.reason = 'import';

  with ins as (
    insert into calls(person_id, lead_id, agent_id, phone_e164, direction, status, started_at, ended_at, duration_seconds, provider, provider_call_id)
    select l.person_id, l.id, ag.id, pe.phone_e164, 'outgoing',
           case when (d #>> '{call,connected}')::boolean then 'connected' else 'not_connected' end::call_status,
           (d #>> '{call,at}')::timestamptz, (d #>> '{call,at}')::timestamptz + make_interval(secs => (d #>> '{call,seconds}')::int),
           (d #>> '{call,seconds}')::int, 'cratio', l.import_ref
      from import_rows r cross join lateral (select r.data as d) x
      join leads l on l.import_ref = p_batch || ':' || r.n
      join people pe on pe.id = l.person_id
      left join lateral (select id from profiles where lower(full_name) = lower(d #>> '{call,agent}') limit 1) ag on true
     where r.batch = p_batch and d -> 'call' is not null and jsonb_typeof(d -> 'call') = 'object'
    on conflict (provider, provider_call_id) do nothing
    returning 1)
  select count(*) into v_calls from ins;

  with ins as (
    insert into site_visits(lead_id, project_id, scheduled_at, done_at, accompanied_by, notes)
    select l.id, l.project_id, coalesce((d ->> 'visit_scheduled')::timestamptz, (d ->> 'visit_done')::timestamptz),
           (d ->> 'visit_done')::timestamptz, l.assigned_to, 'From Cratio'
      from import_rows r cross join lateral (select r.data as d) x
      join leads l on l.import_ref = p_batch || ':' || r.n
     where r.batch = p_batch and coalesce(d ->> 'visit_scheduled', d ->> 'visit_done') is not null
       and not exists (select 1 from site_visits s where s.lead_id = l.id)
    returning 1)
  select count(*) into v_visits from ins;

  with ins as (
    insert into lead_notes(lead_id, body, created_by, created_at)
    select l.id, d ->> 'description', ub.id, coalesce((d ->> 'updated_at')::timestamptz, l.created_at)
      from import_rows r cross join lateral (select r.data as d) x
      join leads l on l.import_ref = p_batch || ':' || r.n
      left join lateral (select id from profiles where lower(full_name) = lower(d ->> 'updated_by') limit 1) ub on true
     where r.batch = p_batch and d ->> 'description' is not null
       and not exists (select 1 from lead_notes nt where nt.lead_id = l.id)
    returning 1)
  select count(*) into v_notes from ins;

  -- numbers that are not a valid mobile (Cratio forces +91 on overseas numbers) are kept as enquiries for admins to fix
  with ins as (
    insert into enquiries(source_id, project_id, status, answer, raw_payload, received_at, provider, external_id)
    select so.id, pr.id, 'invalid_phone', concat_ws(' · ', d ->> 'name', d ->> 'phone', d ->> 'city'), d,
           coalesce((d ->> 'created_at')::timestamptz, now()), 'cratio', p_batch || ':' || r.n
      from import_rows r cross join lateral (select r.data as d) x
      left join sources so on so.name = d ->> 'source'
      left join projects pr on pr.name = d ->> 'project'
     where r.batch = p_batch and r.n > 0 and public.normalize_phone(d ->> 'phone') is null
    on conflict (provider, external_id) where external_id is not null do nothing
    returning 1)
  select count(*) into v_invalid from ins;

  return jsonb_build_object('people_new_or_updated', v_people, 'leads', v_leads, 'calls', v_calls, 'site_visits', v_visits,
                            'notes', v_notes, 'invalid_phone', v_invalid);
end $$;
revoke all on function private.import_cratio(text) from public;

-- the demo leads stay until the owner removes them; tag them so they can be filtered out
update leads set tags = array_append(tags, 'Demo') where import_ref is null and not ('Demo' = any(tags));
