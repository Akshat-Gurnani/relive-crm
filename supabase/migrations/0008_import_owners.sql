-- Relive CRM 0008: imported leads keep their Cratio owner by name until that person has a CRM login.
--   The import no longer needs every Cratio user to exist first: a lead whose owner has no profile yet stays
--   unassigned, with "Owner in Cratio" kept on it. When an admin adds staff with the same name, their leads and
--   calls are linked to them automatically; other names are linked by hand from Admin -> Imported owners.

create or replace function private.import_cratio(p_batch text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_leads int; v_calls int; v_visits int; v_notes int; v_people int; v_invalid int;
begin
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
    insert into calls(person_id, lead_id, agent_id, phone_e164, direction, status, started_at, ended_at, duration_seconds, provider, provider_call_id, raw)
    select l.person_id, l.id, ag.id, pe.phone_e164, 'outgoing',
           case when (d #>> '{call,connected}')::boolean then 'connected' else 'not_connected' end::call_status,
           (d #>> '{call,at}')::timestamptz, (d #>> '{call,at}')::timestamptz + make_interval(secs => (d #>> '{call,seconds}')::int),
           (d #>> '{call,seconds}')::int, 'cratio', l.import_ref, jsonb_build_object('agent', d #>> '{call,agent}')
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

create or replace function private.link_import_owner(p_name text, p_profile uuid) returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  perform set_config('app.assign_reason', 'import', true);
  update leads set assigned_to = p_profile, assigned_at = coalesce(assigned_at, created_at)
   where import_ref is not null and assigned_to is null and lower(legacy ->> 'Owner in Cratio') = lower(btrim(p_name));
  get diagnostics n = row_count;
  update calls set agent_id = p_profile
   where provider = 'cratio' and agent_id is null and lower(raw ->> 'agent') = lower(btrim(p_name));
  update leads set created_by = p_profile
   where import_ref is not null and created_by is null and lower(legacy ->> 'Created by') = lower(btrim(p_name));
  return n;
end $$;
revoke all on function private.link_import_owner(text, uuid) from public;

-- Admin -> Imported owners: every Cratio owner name, how many leads, and how many still wait for a login
create or replace function public.import_owners() returns table(cratio_name text, leads bigint, waiting bigint, linked_to uuid)
language sql stable security definer set search_path = public as $$
  select l.legacy ->> 'Owner in Cratio', count(*), count(*) filter (where l.assigned_to is null),
         (array_agg(l.assigned_to) filter (where l.assigned_to is not null))[1]
    from leads l
   where public.app_current_role() = 'admin' and l.import_ref is not null and l.legacy ? 'Owner in Cratio'
   group by 1 order by 2 desc
$$;
grant execute on function public.import_owners() to authenticated;

create or replace function public.link_import_owner(p_name text, p_profile uuid) returns int
language plpgsql security definer set search_path = public as $$
begin
  if public.app_current_role() <> 'admin' then raise exception 'only admins can link imported leads' using errcode = '42501'; end if;
  if not exists (select 1 from profiles where id = p_profile and active) then raise exception 'pick an active staff member'; end if;
  return private.link_import_owner(p_name, p_profile);
end $$;
grant execute on function public.link_import_owner(text, uuid) to authenticated;

-- new staff with the same name as a Cratio owner pick up their imported leads straight away
create or replace function private.profiles_link_import() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform private.link_import_owner(new.full_name, new.id);
  return null;
end $$;
create trigger profiles_link_import after insert on profiles for each row execute function private.profiles_link_import();
