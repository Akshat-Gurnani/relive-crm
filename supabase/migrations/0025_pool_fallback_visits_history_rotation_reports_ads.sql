-- Relive CRM 0025: eight requests from 5 Nov 2026.
--  1. Open pool per distribution rule: a lead goes to everyone in the rule; the first to log a call keeps it.
--  2. Meetings and site visits: type, status, outcome and feedback on each visit.
--  3. Fallback owner: a lead nobody can take goes to one person (Varsha Gurnani) with an alert, never sits unowned.
--  5. History: field-by-field change log per lead, plus who viewed it and when.
--  6. Team performance report (one database call).
--  7. Idle rotation: no touch for 15 days, or Yet To Talk for 5 days, moves the lead on. Starts switched OFF.
--  8. Meta ad spend by day and ad, joined to what the CRM did with those leads.
-- Safe to run twice. Nothing here changes how a lead is routed until a rule is switched to "open pool".

-- ---------------------------------------------------------------- settings
insert into app_settings(key, value)
values ('fallback_owner', jsonb_build_object('user_id', (select id from profiles where full_name ilike 'varsha gurnani' and active order by created_at limit 1)))
on conflict (key) do nothing;
insert into app_settings(key, value) values ('pool', '{"timeout_minutes": 60}'::jsonb) on conflict (key) do nothing;
insert into app_settings(key, value)
values ('rotation', '{"enabled": false, "minutes": 30, "work_start": "09:00", "work_end": "21:00", "max_rotations": 5, "only_new_within_hours": 24}'::jsonb)
on conflict (key) do nothing;
update app_settings
   set value = '{"idle_enabled": false, "idle_days": 15, "ytt_days": 5, "followup_grace_days": 15, "idle_max": 10, "idle_batch": 25}'::jsonb || value
 where key = 'rotation';

create or replace function private.fallback_owner() returns uuid
language sql stable security definer set search_path = public as $$
  select pr.id from app_settings s join profiles pr on pr.id = nullif(s.value ->> 'user_id', '')::uuid
   where s.key = 'fallback_owner' and pr.active limit 1
$$;

-- new reasons a lead can change hands
alter table lead_assignments drop constraint if exists lead_assignments_reason_check;
alter table lead_assignments add constraint lead_assignments_reason_check
  check (reason in ('capture', 'create', 'manual', 'rotation', 'import', 'claim', 'pool', 'pool_timeout', 'fallback', 'rotation_idle', 'rotation_ytt'));

-- ---------------------------------------------------------------- 1. open pool
alter table routing_rules add column if not exists claim_mode boolean not null default false;
alter table leads add column if not exists pool_rule_id uuid references routing_rules(id) on delete set null;
alter table leads add column if not exists pooled_at timestamptz;
alter table leads add column if not exists idle_rotations int not null default 0;
create index if not exists leads_pool_idx on leads(pool_rule_id) where pool_rule_id is not null;

-- Is the signed-in person an active member of this rule (so they may see its open leads)?
create or replace function public.in_lead_pool(p_rule uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select p_rule is not null and exists (
    select 1 from routing_members m join profiles pr on pr.id = m.user_id
     where m.rule_id = p_rule and m.user_id = auth.uid() and m.active and pr.active)
$$;

drop policy if exists leads_read on leads;
create policy leads_read on leads for select to authenticated
  using (public.can_see_lead(assigned_to, project_id) or (assigned_to is null and public.in_lead_pool(pool_rule_id)));

create or replace function public.can_see_lead_id(p_lead uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from leads l where l.id = p_lead
                   and (public.can_see_lead(l.assigned_to, l.project_id) or (l.assigned_to is null and public.in_lead_pool(l.pool_rule_id))))
$$;

-- Hands an open lead to the person who acted first. Row lock makes two near-simultaneous calls safe: only one wins.
create or replace function private.claim_pool_lead(p_lead uuid, p_user uuid, p_how text) returns boolean
language plpgsql security definer set search_path = public as $$
declare v_rule uuid; v_name text; v_label text;
begin
  if p_lead is null or p_user is null then return false; end if;
  select pool_rule_id into v_rule from leads where id = p_lead and assigned_to is null and pool_rule_id is not null for update;
  if v_rule is null then return false; end if;
  if not exists (select 1 from routing_members where rule_id = v_rule and user_id = p_user and active) then return false; end if;
  perform set_config('app.assign_reason', 'claim', true);
  update leads set assigned_to = p_user, pool_rule_id = null, routing_rule_id = coalesce(routing_rule_id, v_rule) where id = p_lead;
  perform set_config('app.assign_reason', '', true);
  update routing_members set served = served + 1, last_at = clock_timestamp() where rule_id = v_rule and user_id = p_user;
  select full_name into v_name from profiles where id = p_user;
  v_label := public.lead_label(p_lead);
  perform public.notify(m.user_id, 'lead_claimed', 'Lead taken by ' || coalesce(v_name, 'a colleague'), v_label || ' · ' || p_how || ' first', p_lead)
     from routing_members m where m.rule_id = v_rule and m.active and m.user_id <> p_user;
  return true;
end $$;

-- An agent may set themselves as owner of an open-pool lead (only reachable through the claim function: RLS blocks direct updates).
create or replace function public.leads_before_update() returns trigger
language plpgsql security definer set search_path = public as $$
declare k stage_kind; r app_role;
begin
  r := public.app_current_role();
  if auth.uid() is not null and new.assigned_to is distinct from old.assigned_to
     and coalesce(r::text, '') not in ('admin', 'manager')
     and not (old.assigned_to is null and old.pool_rule_id is not null and new.assigned_to = auth.uid())
     and not ((new.assigned_to = auth.uid() or public.reports_to_me(new.assigned_to))
              and (old.assigned_to = auth.uid() or public.reports_to_me(old.assigned_to))
              and (public.reports_to_me(new.assigned_to) or public.reports_to_me(old.assigned_to))) then
    raise exception 'only managers or admins can reassign leads';
  end if;
  if new.assigned_to is distinct from old.assigned_to then
    new.assigned_at := case when new.assigned_to is null then null else now() end;
    if new.assigned_to is not null then new.pool_rule_id := null; end if;
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

-- log_call: open-pool leads are matched by phone too, and a logged call claims the lead.
create or replace function public.log_call(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid(); v_role app_role := public.app_current_role();
  v_phone text := public.normalize_phone(p ->> 'phone');
  v_person uuid; v_lead uuid := nullif(p ->> 'lead_id', '')::uuid; v_call uuid;
  v_started timestamptz := coalesce(nullif(p ->> 'started_at', '')::timestamptz, now());
  v_dur int := greatest(0, coalesce(nullif(p ->> 'duration_seconds', '')::int, 0));
  v_dir call_direction := coalesce(nullif(p ->> 'direction', ''), 'outgoing')::call_direction;
  v_status call_status; v_claimed boolean := false;
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
       where l.person_id = v_person
         and (public.can_see_lead(l.assigned_to, l.project_id) or (l.assigned_to is null and public.in_lead_pool(l.pool_rule_id)))
       order by (l.assigned_to = v_uid) desc nulls last, (s.kind = 'open') desc, l.last_activity_at desc limit 1;
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
    if v_dir = 'outgoing' or v_status = 'connected' then
      v_claimed := private.claim_pool_lead(v_lead, v_uid, 'called');
    end if;
    update leads set last_activity_at = greatest(last_activity_at, v_started),
                     first_contacted_at = case when v_dir = 'outgoing' or v_status = 'connected'
                                               then coalesce(first_contacted_at, v_started) else first_contacted_at end
     where id = v_lead;
  end if;
  return jsonb_build_object('status', 'logged', 'call_id', v_call, 'lead_id', v_lead, 'person_id', v_person,
                            'matched', v_lead is not null, 'claimed', v_claimed);
end $$;

-- A call logged by hand as an activity claims the lead too.
create or replace function public.activities_after_change() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' and new.type = 'call' and new.created_by is not null then
    perform private.claim_pool_lead(new.lead_id, new.created_by, 'logged a call');
  end if;
  if new.completed_at is not null and new.type in ('call', 'whatsapp', 'meeting') then
    update leads set first_contacted_at = coalesce(first_contacted_at, new.completed_at),
                     last_activity_at = greatest(last_activity_at, new.completed_at)
     where id = new.lead_id;
  end if;
  return null;
end $$;

-- Assignment alerts: new reasons (claim, pool timeout, fallback, idle rotations).
create or replace function public.lead_assignments_notify() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_label text; v_to text;
begin
  if new.reason in ('import', 'fallback', 'pool') then return null; end if;  -- fallback is announced with its reason by the caller
  v_label := public.lead_label(new.lead_id);
  if new.to_user is not null and new.to_user is distinct from new.changed_by then
    perform public.notify(new.to_user, 'lead_assigned',
      case new.reason when 'rotation' then 'Lead passed to you (not yet called)'
                      when 'rotation_idle' then 'Lead passed to you (untouched for too long)'
                      when 'rotation_ytt' then 'Lead passed to you (stuck in Yet To Talk)'
                      when 'pool_timeout' then 'Lead assigned to you (nobody called it in time)'
                      when 'manual' then 'Lead re-assigned to you'
                      else 'New lead assigned to you' end,
      v_label, new.lead_id);
  end if;
  if new.reason in ('rotation', 'rotation_idle', 'rotation_ytt') and new.from_user is not null then
    select full_name into v_to from profiles where id = new.to_user;
    perform public.notify(new.from_user, 'lead_rotated', 'Lead moved to ' || coalesce(v_to, 'another agent'),
      v_label || case new.reason when 'rotation' then ' was not called in time'
                                 when 'rotation_ytt' then ' stayed in Yet To Talk too long'
                                 else ' had no activity for too long' end, new.lead_id);
  end if;
  return null;
end $$;

-- ingest_lead: same as 0024, plus (a) open-pool rules and (b) the fallback owner instead of an unowned lead.
create or replace function public.ingest_lead(p_endpoint uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  ep capture_endpoints%rowtype;
  rl routing_rules%rowtype;
  fm form_mappings%rowtype;
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
  v_source uuid; v_project uuid; v_named text; v_rule uuid; v_priority text;
  v_old_project uuid; v_attn text; v_ad text; v_prev record; v_prev_label text;
  v_pool boolean := false; v_bounced boolean := false; v_why text;
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
  select string_agg(initcap(replace(key, '_', ' ')) || ': ' || value, ' · ')
    into v_summary from jsonb_each_text(coalesce(v_answers, '{}'::jsonb)) where nullif(btrim(value), '') is not null;
  v_answer := coalesce(v_answer, v_summary);

  v_named := concat_ws(' ', p ->> 'form_name', p ->> 'campaign_name', p ->> 'adset_name');
  if ep.id is not null and cardinality(ep.match_form_ids) > 0 then
    v_source := ep.source_id; v_project := ep.project_id;
  else
    v_source := coalesce(public.source_from_text(v_named), ep.source_id);
    v_project := coalesce(public.project_from_text(v_named), ep.project_id);
  end if;

  select * into fm from form_mappings where active and form_id = p ->> 'form_id';
  if found then
    v_source := coalesce(fm.source_id, v_source);
    v_project := coalesce(fm.project_id, v_project);
  end if;

  v_rule := public.match_rule(p, ep.id, v_project);
  if v_rule is not null then
    select * into rl from routing_rules where id = v_rule;
    v_source := coalesce(rl.set_source_id, v_source);
    v_project := coalesce(rl.set_project_id, v_project);
  end if;
  v_priority := coalesce(rl.set_priority, fm.priority, ep.default_priority, 'Medium');
  v_ad := nullif(coalesce(p ->> 'ad_name', p ->> 'form_name', p ->> 'campaign_name'), '');
  -- an open-pool rule needs at least one person who can take leads, otherwise it behaves like a normal rule
  v_pool := v_rule is not null and coalesce(rl.claim_mode, false) and exists (
    select 1 from routing_members m join profiles pr on pr.id = m.user_id
     where m.rule_id = v_rule and m.active and pr.active and pr.accepting_leads);

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

  select l.id, l.assigned_to, l.project_id into v_lead, v_owner, v_old_project
    from leads l join stages s on s.id = l.stage_id
   where l.person_id = v_person and s.kind = 'open'
   order by (l.assigned_to is not null) desc, l.last_activity_at desc nulls last, l.created_at desc limit 1;

  if v_lead is not null then
    v_re := true;
    v_attn := case
      when v_project is not null and v_old_project is distinct from v_project then
        'Enquired again, now about ' || (select name from projects where id = v_project)
          || case when v_old_project is not null then ' (this lead is for ' || (select name from projects where id = v_old_project) || ')' else '' end
          || coalesce(' · ad: ' || v_ad, '')
      else 'Enquired again' || coalesce(' · ad: ' || v_ad, '') end;
    update leads set
      reenquiry_count = reenquiry_count + 1,
      temperature = case when temperature = 'cold' then 'warm'::temperature else temperature end,
      next_followup_at = least(coalesce(next_followup_at, now()), now()),
      last_activity_at = now(),
      attention = v_attn, attention_at = now()
    where id = v_lead;
    insert into activities(lead_id, type, notes, completed_at)
    values (v_lead, 're_enquiry', v_attn || coalesce(': ' || v_answer, ''), now());
    if v_owner is not null and exists (select 1 from profiles where id = v_owner and active) then
      perform public.notify(v_owner, 'reenquiry', 'ATTENTION: your lead enquired again', public.lead_label(v_lead) || ' · ' || v_attn, v_lead);
    elsif v_pool then
      perform set_config('app.assign_reason', 'pool', true);
      update leads set assigned_to = null, pool_rule_id = v_rule, pooled_at = now(), routing_rule_id = coalesce(routing_rule_id, v_rule) where id = v_lead;
      perform set_config('app.assign_reason', '', true);
      perform public.notify(m.user_id, 'lead_pool', 'Open lead enquired again: first to call keeps it', public.lead_label(v_lead) || ' · ' || v_attn, v_lead)
         from routing_members m join profiles pr on pr.id = m.user_id where m.rule_id = v_rule and m.active and pr.active;
    else
      v_assignee := case when v_rule is not null then public.pick_from_rule(v_rule) else public.pick_lead_owner(ep.team_id) end;
      if v_assignee is null then
        v_assignee := private.fallback_owner(); v_bounced := v_assignee is not null;
      end if;
      if v_assignee is not null then
        if v_bounced then perform set_config('app.assign_reason', 'fallback', true); end if;
        update leads set assigned_to = v_assignee, routing_rule_id = coalesce(v_rule, routing_rule_id) where id = v_lead;
        perform set_config('app.assign_reason', '', true);
        perform public.notify(v_assignee, 'reenquiry',
                              case when v_bounced then 'Lead bounced to you: re-enquiry nobody could take' else 'ATTENTION: lead enquired again' end,
                              public.lead_label(v_lead) || ' · ' || v_attn, v_lead);
      else
        perform public.notify(pr.id, 'lead_unassigned', 'Re-enquiry on a lead with no owner', public.lead_label(v_lead), v_lead)
           from profiles pr where pr.role = 'admin' and pr.active;
      end if;
    end if;
  else
    select id into v_stage from stages where is_default;
    if v_rule is not null and not v_pool then
      v_assignee := public.pick_from_rule(v_rule);
    end if;
    if v_assignee is null and v_rule is null then
      select id into v_assignee from profiles where id = coalesce(fm.assign_to, ep.assign_to) and active;
      v_assignee := coalesce(v_assignee, public.pick_lead_owner(ep.team_id));
    end if;
    if v_assignee is null and not v_pool then
      v_assignee := private.fallback_owner();
      v_bounced := v_assignee is not null;
      v_why := case when v_rule is null then 'no distribution rule matched and nobody was free'
                    else 'nobody available in "' || rl.name || '"' end;
    end if;
    select l.id, s.name sname, s.kind skind, l.created_at, (select name from projects where id = l.project_id) pname,
           (select full_name from profiles where id = l.assigned_to) oname
      into v_prev from leads l join stages s on s.id = l.stage_id
     where l.person_id = v_person and s.kind <> 'open' order by l.stage_changed_at desc nulls last, l.created_at desc limit 1;
    if v_prev.sname is not null then
      v_attn := 'Returning enquiry: earlier lead was ' || v_prev.sname || coalesce(' for ' || v_prev.pname, '') || coalesce(' with ' || v_prev.oname, '')
                || ' (' || to_char(v_prev.created_at at time zone 'Asia/Kolkata', 'DD Mon YYYY') || ')' || coalesce(' · ad: ' || v_ad, '');
    end if;
    if v_bounced then perform set_config('app.assign_reason', 'fallback', true); end if;
    insert into leads(person_id, project_id, source_id, stage_id, assigned_to, next_followup_at, created_at, description,
                      vendor_id, provider, campaign_id, campaign_name, adset_id, adset_name, ad_id, ad_name,
                      form_id, form_name, platform, priority, routing_rule_id, attention, attention_at, pool_rule_id, pooled_at)
    values (v_person, v_project, v_source, v_stage, v_assignee, now(), v_received, v_answer,
            ep.vendor_id, v_provider, p ->> 'campaign_id', p ->> 'campaign_name', p ->> 'adset_id', p ->> 'adset_name',
            p ->> 'ad_id', p ->> 'ad_name', p ->> 'form_id', p ->> 'form_name', p ->> 'platform',
            v_priority, v_rule, v_attn, case when v_attn is not null then now() end,
            case when v_pool then v_rule end, case when v_pool then now() end)
    returning id into v_lead;
    perform set_config('app.assign_reason', '', true);
    perform public.apply_answers(v_lead, v_answers);
    v_label := public.lead_label(v_lead);
    if v_pool then
      perform public.notify(m.user_id, 'lead_pool', 'Open lead: first to call keeps it', v_label || coalesce(' · ' || v_attn, ''), v_lead)
         from routing_members m join profiles pr on pr.id = m.user_id where m.rule_id = v_rule and m.active and pr.active;
    end if;
    if v_attn is not null and v_assignee is not null then
      perform public.notify(v_assignee, 'reenquiry', 'ATTENTION: returning customer', v_label || ' · ' || v_attn, v_lead);
    end if;
    if v_bounced then
      perform public.notify(v_assignee, 'lead_bounced', 'Lead bounced to you: ' || v_why, v_label, v_lead);
    elsif v_assignee is null and not v_pool then
      perform public.notify(pr.id, 'lead_unassigned',
                            case when v_rule is null then 'New lead waiting to be assigned (no routing list matched)'
                                 else 'New lead waiting: nobody available in "' || rl.name || '"' end, v_label, v_lead)
         from profiles pr
        where pr.active and (pr.role = 'admin' or (pr.role = 'manager' and ep.team_id is not null and pr.team_id = ep.team_id));
    end if;
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
          || coalesce(' · ' || nullif(p ->> 'form_name', ''), '') || coalesce(' · list: ' || rl.name, '')
          || case when v_pool and not v_re then ' · open pool' when v_bounced then ' · fallback owner' else '' end);

  return jsonb_build_object('status', 'processed', 'reenquiry', v_re,
                            'person_id', v_person, 'lead_id', v_lead, 'enquiry_id', v_enq,
                            'endpoint_id', ep.id, 'rule', rl.name, 'pool', v_pool and not v_re, 'fallback', v_bounced,
                            'assigned_to', (select assigned_to from leads where id = v_lead));
end $$;

-- ---------------------------------------------------------------- 2. meetings and site visits
alter table site_visits add column if not exists kind text not null default 'site_visit';
alter table site_visits add column if not exists status text not null default 'planned';
alter table site_visits add column if not exists outcome text;
alter table site_visits add column if not exists feedback text;
alter table site_visits add column if not exists location text;
alter table site_visits add column if not exists created_by uuid references profiles(id) on delete set null;
alter table site_visits add column if not exists updated_at timestamptz not null default now();
do $$ begin
  alter table site_visits add constraint site_visits_kind_chk check (kind in ('site_visit', 'meeting', 'office_visit', 'video_call'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table site_visits add constraint site_visits_status_chk check (status in ('planned', 'done', 'cancelled', 'no_show'));
exception when duplicate_object then null; end $$;
update site_visits set status = 'done' where done_at is not null and status = 'planned';
create index if not exists site_visits_lead_idx on site_visits(lead_id);
create index if not exists site_visits_done_idx on site_visits(done_at) where done_at is not null;

create or replace function public.site_visits_before() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then new.created_by := coalesce(new.created_by, auth.uid()); end if;
  if new.status = 'done' and new.done_at is null then new.done_at := now(); end if;
  if new.done_at is not null and new.status = 'planned' then new.status := 'done'; end if;
  if new.status in ('planned', 'cancelled', 'no_show') and tg_op = 'UPDATE' and old.status = 'done' and new.status <> 'done' then new.done_at := null; end if;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists site_visits_before on site_visits;
create trigger site_visits_before before insert or update on site_visits for each row execute function public.site_visits_before();

-- A visit or meeting that happened counts as contact on the lead (and resets the idle clock).
create or replace function public.site_visits_after() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'done' and new.done_at is not null and (tg_op = 'INSERT' or old.status is distinct from 'done') then
    update leads set first_contacted_at = coalesce(first_contacted_at, new.done_at),
                     last_activity_at = greatest(coalesce(last_activity_at, new.done_at), new.done_at)
     where id = new.lead_id;
  end if;
  return null;
end $$;
drop trigger if exists site_visits_after on site_visits;
create trigger site_visits_after after insert or update on site_visits for each row execute function public.site_visits_after();
drop trigger if exists audit_site_visits on site_visits;
create trigger audit_site_visits after insert or update or delete on site_visits for each row execute function public.audit_row();

-- ---------------------------------------------------------------- 7. rotation: open-pool timeout + idle rules
create or replace function private.expire_pool() returns int
language plpgsql security definer set search_path = public as $$
declare v_min int; r record; v_next uuid; v_reason text; n int := 0;
begin
  select coalesce((value ->> 'timeout_minutes')::int, 0) into v_min from app_settings where key = 'pool';
  if coalesce(v_min, 0) <= 0 then return 0; end if;
  for r in
    select l.id, l.pool_rule_id from leads l
     where l.pool_rule_id is not null and l.assigned_to is null and l.pooled_at < now() - make_interval(mins => v_min)
     order by l.pooled_at limit 50 for update of l skip locked
  loop
    v_next := public.pick_from_rule(r.pool_rule_id); v_reason := 'pool_timeout';
    if v_next is null then v_next := private.fallback_owner(); v_reason := 'fallback'; end if;
    continue when v_next is null;
    perform set_config('app.assign_reason', v_reason, true);
    update leads set assigned_to = v_next, pool_rule_id = null where id = r.id;
    perform set_config('app.assign_reason', '', true);
    if v_reason = 'fallback' then
      perform public.notify(v_next, 'lead_bounced', 'Lead bounced to you: open lead nobody called', public.lead_label(r.id), r.id);
    end if;
    n := n + 1;
  end loop;
  return n;
end $$;

-- Which open leads the idle rules would move right now. Used by rotate_idle and by the admin preview.
create or replace function private.idle_candidates(s jsonb) returns table(lead_id uuid, assigned_to uuid, reason text, last_touch timestamptz)
language sql stable security definer set search_path = public as $$
  with ytt as (select id from stages where lower(name) = 'yet to talk' limit 1),
  base as (
    select l.id, l.assigned_to, l.stage_id, l.next_followup_at,
           greatest(coalesce(l.stage_changed_at, l.created_at), coalesce(l.assigned_at, l.created_at)) as in_stage_since,
           greatest(l.created_at, coalesce(l.last_activity_at, l.created_at), coalesce(l.stage_changed_at, l.created_at),
                    coalesce(l.assigned_at, l.created_at),
                    coalesce((select max(n.created_at) from lead_notes n where n.lead_id = l.id), l.created_at),
                    coalesce((select max(v.updated_at) from site_visits v where v.lead_id = l.id), l.created_at)) as touched
      from leads l join stages st on st.id = l.stage_id and st.kind = 'open'
      join profiles p on p.id = l.assigned_to and p.active
     where l.pool_rule_id is null and l.idle_rotations < coalesce((s ->> 'idle_max')::int, 10)
  )
  select b.id, b.assigned_to,
         case when b.stage_id = (select id from ytt) and b.in_stage_since < now() - make_interval(days => coalesce((s ->> 'ytt_days')::int, 5))
              then 'rotation_ytt' else 'rotation_idle' end,
         b.touched
    from base b
   where (b.stage_id = (select id from ytt) and b.in_stage_since < now() - make_interval(days => coalesce((s ->> 'ytt_days')::int, 5)))
      or (b.touched < now() - make_interval(days => coalesce((s ->> 'idle_days')::int, 15))
          and not coalesce(b.next_followup_at >= now() and b.next_followup_at < now() + make_interval(days => coalesce((s ->> 'followup_grace_days')::int, 15)), false))
$$;

create or replace function private.rotate_idle(s jsonb) returns int
language plpgsql security definer set search_path = public as $$
declare r record; v_rule uuid; v_next uuid; n int := 0;
begin
  if not coalesce((s ->> 'idle_enabled')::boolean, false) then return 0; end if;
  for r in
    select c.lead_id, c.assigned_to, c.reason, l.routing_rule_id, l.project_id, p.team_id
      from private.idle_candidates(s) c join leads l on l.id = c.lead_id join profiles p on p.id = c.assigned_to
     order by c.last_touch limit coalesce((s ->> 'idle_batch')::int, 25)
  loop
    v_rule := coalesce(r.routing_rule_id, (
      select rr.id from routing_rules rr
       where rr.active and rr.match_project_id = r.project_id and cardinality(rr.form_ids) = 0 and cardinality(rr.campaign_ids) = 0
         and cardinality(rr.adset_ids) = 0 and cardinality(rr.ad_ids) = 0 and rr.name_contains is null
       order by rr.position, rr.created_at limit 1));
    v_next := case when v_rule is not null then public.pick_from_rule(v_rule, r.assigned_to)
                   else public.pick_assignee_except(r.team_id, r.assigned_to) end;
    continue when v_next is null;
    perform set_config('app.assign_reason', r.reason, true);
    update leads set assigned_to = v_next, idle_rotations = idle_rotations + 1, routing_rule_id = coalesce(routing_rule_id, v_rule)
     where id = r.lead_id and assigned_to = r.assigned_to;
    perform set_config('app.assign_reason', '', true);
    n := n + 1;
  end loop;
  return n;
end $$;

-- Same new-lead rotation as 0015, plus the pool timeout (always on) and the idle rules (when switched on).
create or replace function public.rotate_untouched() returns integer
language plpgsql security definer set search_path = public as $$
declare
  s jsonb; v_now_ist time; r record; v_next uuid; n int := 0;
begin
  select value into s from app_settings where key = 'rotation';
  v_now_ist := (now() at time zone 'Asia/Kolkata')::time;
  if s is not null and (v_now_ist < coalesce(s ->> 'work_start', '09:00')::time or v_now_ist >= coalesce(s ->> 'work_end', '21:00')::time) then return 0; end if;
  n := private.expire_pool();
  if s is null then return n; end if;
  n := n + private.rotate_idle(s);
  if not coalesce((s ->> 'enabled')::boolean, false) then return n; end if;

  for r in
    select l.id, l.assigned_to, l.routing_rule_id, p.team_id
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
    v_next := case when r.routing_rule_id is not null then public.pick_from_rule(r.routing_rule_id, r.assigned_to)
                   else public.pick_assignee_except(r.team_id, r.assigned_to) end;
    continue when v_next is null;
    perform set_config('app.assign_reason', 'rotation', true);
    update leads set assigned_to = v_next, rotation_count = rotation_count + 1 where id = r.id;
    n := n + 1;
  end loop;
  perform set_config('app.assign_reason', '', true);
  return n;
end $$;

-- Admin preview: how many leads the idle rules would move, before switching them on.
create or replace function public.rotation_preview(p_settings jsonb default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare s jsonb;
begin
  if public.app_current_role() is distinct from 'admin' then raise exception 'admins only' using errcode = '42501'; end if;
  select coalesce(p_settings, value) into s from app_settings where key = 'rotation';
  return (
    select jsonb_build_object(
      'total', count(*),
      'ytt', count(*) filter (where c.reason = 'rotation_ytt'),
      'idle', count(*) filter (where c.reason = 'rotation_idle'),
      'by_owner', coalesce((select jsonb_agg(x order by x.n desc) from (
          select pr.full_name as name, count(*) as n from private.idle_candidates(s) c2 join profiles pr on pr.id = c2.assigned_to
           group by pr.full_name order by count(*) desc limit 12) x), '[]'::jsonb))
      from private.idle_candidates(s) c);
end $$;

-- ---------------------------------------------------------------- 5. history: views and field changes
create table if not exists public.lead_views (
  lead_id uuid not null references leads(id) on delete cascade,
  user_id uuid not null references profiles(id) on delete cascade,
  first_at timestamptz not null default now(),
  last_at timestamptz not null default now(),
  views int not null default 1,
  primary key (lead_id, user_id)
);
create index if not exists lead_views_user_idx on lead_views(user_id, last_at desc);
alter table lead_views enable row level security;
drop policy if exists lead_views_read on lead_views;
create policy lead_views_read on lead_views for select to authenticated
  using (user_id = auth.uid() or public.app_current_role() in ('admin', 'manager') or public.reports_to_me(user_id));

create or replace function public.touch_lead_view(p_lead uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or not public.can_see_lead_id(p_lead) then return; end if;
  insert into lead_views(lead_id, user_id) values (p_lead, auth.uid())
  on conflict (lead_id, user_id) do update set last_at = now(), views = lead_views.views + 1
   where lead_views.last_at < now() - interval '1 minute';
end $$;

create index if not exists audit_log_row_idx on audit_log(table_name, row_id, at);

-- Field-by-field changes on one lead, newest first. Anyone who can see the lead can read its history.
create or replace function public.lead_history(p_lead uuid, p_limit int default 300)
returns table(at timestamptz, actor uuid, field text, old_value text, new_value text)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.can_see_lead_id(p_lead) then return; end if;
  return query
    select a.at, a.actor, k.key, a.old_data ->> k.key, a.new_data ->> k.key
      from audit_log a cross join lateral jsonb_object_keys(a.new_data) k(key)
     where a.table_name = 'leads' and a.row_id = p_lead and a.op = 'UPDATE'
       and (a.old_data -> k.key) is distinct from (a.new_data -> k.key)
       and k.key not in ('updated_at', 'followup_reminded_at', 'stage_changed_at', 'assigned_at', 'last_activity_at', 'first_contacted_at',
                         'converted_at', 'lost_at', 'attention_at', 'rotation_count', 'idle_rotations', 'pooled_at', 'reenquiry_count')
     order by a.at desc, a.id desc
     limit p_limit;
end $$;

-- ---------------------------------------------------------------- 6. team performance report
-- One row per person in scope: admins see everyone, team leaders see themselves and their reports, agents themselves.
create or replace function public.team_report(p_from timestamptz, p_to timestamptz) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_role app_role := public.app_current_role(); v_uid uuid := auth.uid(); out jsonb; idle int := 15;
begin
  if v_role is null or v_role not in ('admin', 'manager', 'agent') then raise exception 'not allowed' using errcode = '42501'; end if;
  idle := coalesce((select (value ->> 'idle_days')::int from app_settings where key = 'rotation'), 15);
  with scope as (
    select pr.id, pr.full_name, pr.role from profiles pr
     where pr.active and pr.role in ('admin', 'manager', 'agent')
       and (v_role = 'admin' or pr.id = v_uid or public.reports_to_me(pr.id)
            or (v_role = 'manager' and pr.team_id is not null and pr.team_id = public.app_current_team()))
  ),
  asg as (
    select la.to_user u, la.lead_id, min(la.at) at from lead_assignments la
     where la.at >= p_from and la.at < p_to and la.to_user in (select id from scope) group by 1, 2
  ),
  resp as (
    select a.u, a.lead_id, extract(epoch from (
             (select min(c.started_at) from calls c where c.lead_id = a.lead_id and c.agent_id = a.u and c.started_at >= a.at) - a.at)) / 60.0 mins
      from asg a
  ),
  r1 as (
    select u, count(*) assigned, count(mins) contacted,
           percentile_cont(0.5) within group (order by mins) median_first_call_min,
           count(*) filter (where mins <= 5) within_5, count(*) filter (where mins <= 60) within_60
      from resp group by u
  ),
  c1 as (
    select c.agent_id u, count(*) calls, count(*) filter (where c.status = 'connected') connected,
           coalesce(sum(c.duration_seconds), 0) talk_seconds, count(distinct c.lead_id) leads_called,
           count(distinct (c.started_at at time zone 'Asia/Kolkata')::date) active_days
      from calls c where c.started_at >= p_from and c.started_at < p_to and c.agent_id in (select id from scope) group by 1
  ),
  v1 as (
    select coalesce(v.accompanied_by, v.created_by, l.assigned_to) u,
           count(*) filter (where v.created_at >= p_from and v.created_at < p_to) planned,
           count(*) filter (where v.status = 'done' and v.done_at >= p_from and v.done_at < p_to) done
      from site_visits v join leads l on l.id = v.lead_id group by 1
  ),
  s1 as (
    select coalesce(h.changed_by, l.assigned_to) u,
           count(*) filter (where st.kind = 'won') won, count(*) filter (where st.kind = 'lost') lost
      from lead_stage_history h join stages st on st.id = h.to_stage_id join leads l on l.id = h.lead_id
     where h.changed_at >= p_from and h.changed_at < p_to and h.from_stage_id is not null group by 1
  ),
  m1 as (
    select from_user u, count(*) filter (where reason like 'rotation%') rotated_away from lead_assignments
     where at >= p_from and at < p_to and from_user is not null group by 1
  ),
  m2 as (
    select to_user u, count(*) filter (where reason = 'claim') claimed from lead_assignments
     where at >= p_from and at < p_to group by 1
  ),
  n1 as (
    select l.assigned_to u, count(*) open_now,
           count(*) filter (where l.next_followup_at < now()) overdue,
           count(*) filter (where l.first_contacted_at is null) never_contacted,
           count(*) filter (where greatest(l.created_at, coalesce(l.last_activity_at, l.created_at), coalesce(l.stage_changed_at, l.created_at)) < now() - make_interval(days => idle)) idle
      from leads l join stages st on st.id = l.stage_id and st.kind = 'open' group by 1
  )
  select jsonb_agg(jsonb_build_object(
    'id', s.id, 'name', s.full_name, 'role', s.role,
    'assigned', coalesce(r1.assigned, 0), 'contacted', coalesce(r1.contacted, 0),
    'median_first_call_min', round(r1.median_first_call_min::numeric, 1),
    'within_5', coalesce(r1.within_5, 0), 'within_60', coalesce(r1.within_60, 0),
    'calls', coalesce(c1.calls, 0), 'connected', coalesce(c1.connected, 0), 'talk_seconds', coalesce(c1.talk_seconds, 0),
    'leads_called', coalesce(c1.leads_called, 0), 'active_days', coalesce(c1.active_days, 0),
    'visits_planned', coalesce(v1.planned, 0), 'visits_done', coalesce(v1.done, 0),
    'won', coalesce(s1.won, 0), 'lost', coalesce(s1.lost, 0),
    'rotated_away', coalesce(m1.rotated_away, 0), 'claimed', coalesce(m2.claimed, 0),
    'open_now', coalesce(n1.open_now, 0), 'overdue', coalesce(n1.overdue, 0),
    'never_contacted', coalesce(n1.never_contacted, 0), 'idle', coalesce(n1.idle, 0)
  ) order by s.full_name) into out
  from scope s
  left join r1 on r1.u = s.id left join c1 on c1.u = s.id left join v1 on v1.u = s.id left join s1 on s1.u = s.id
  left join m1 on m1.u = s.id left join m2 on m2.u = s.id left join n1 on n1.u = s.id;
  return coalesce(out, '[]'::jsonb);
end $$;

-- Funnel of leads created in the period, by lead source or project (admins and team leaders; counts only).
create or replace function public.funnel_report(p_from timestamptz, p_to timestamptz, p_by text default 'source') returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_role app_role := public.app_current_role(); out jsonb;
begin
  if v_role is null or v_role not in ('admin', 'manager', 'agent', 'marketing') then raise exception 'not allowed' using errcode = '42501'; end if;
  select jsonb_agg(to_jsonb(x) order by x.leads desc) into out from (
    select coalesce(case when p_by = 'project' then pj.name else so.name end, 'Not set') as name,
           count(*) leads,
           count(*) filter (where l.first_contacted_at is not null) contacted,
           count(*) filter (where exists (select 1 from site_visits v where v.lead_id = l.id and v.status = 'done')) visited,
           count(*) filter (where st.kind = 'won') won,
           count(*) filter (where st.kind = 'lost') lost,
           count(*) filter (where st.kind = 'open') open,
           round(avg(extract(epoch from (l.first_contacted_at - l.created_at)) / 60.0) filter (where l.first_contacted_at >= l.created_at)::numeric, 0) avg_first_contact_min
      from leads l join stages st on st.id = l.stage_id
      left join sources so on so.id = l.source_id left join projects pj on pj.id = l.project_id
     where l.created_at >= p_from and l.created_at < p_to
       and (v_role in ('admin', 'marketing') or public.can_see_lead(l.assigned_to, l.project_id))
     group by 1) x;
  return coalesce(out, '[]'::jsonb);
end $$;

-- ---------------------------------------------------------------- 8. Meta ad spend
create table if not exists public.meta_ad_insights (
  day date not null,
  ad_id text not null,
  account_id text,
  account_name text,
  campaign_id text,
  campaign_name text,
  adset_id text,
  adset_name text,
  ad_name text,
  currency text,
  spend numeric(14, 2) not null default 0,
  impressions bigint not null default 0,
  clicks bigint not null default 0,
  meta_leads int not null default 0,
  refreshed_at timestamptz not null default now(),
  primary key (day, ad_id)
);
create index if not exists meta_ad_insights_account_idx on meta_ad_insights(account_id, day);
create index if not exists leads_ad_idx on leads(ad_id) where ad_id is not null;
alter table meta_ad_insights enable row level security;
drop policy if exists meta_ad_insights_read on meta_ad_insights;
create policy meta_ad_insights_read on meta_ad_insights for select to authenticated
  using (public.app_current_role() in ('admin', 'marketing'));

-- Spend from Meta joined to what happened to the leads those ads produced. Each ad's spend is shared equally across the
-- CRM leads it produced in the period, so spend can be summed by source, project and owner. Admins and marketing only.
create or replace function public.ads_report(p_from date, p_to date) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare out jsonb;
begin
  if public.app_current_role() not in ('admin', 'marketing') then raise exception 'admins and marketing only' using errcode = '42501'; end if;
  with spend as (
    select ad_id, max(account_id) account_id, max(account_name) account_name, max(campaign_id) campaign_id, max(campaign_name) campaign_name,
           max(adset_name) adset_name, max(ad_name) ad_name, max(currency) currency,
           sum(spend) spend, sum(impressions) impressions, sum(clicks) clicks, sum(meta_leads) meta_leads
      from meta_ad_insights where day >= p_from and day <= p_to group by ad_id
  ),
  crm as (
    select l.id, l.ad_id, l.source_id, l.project_id, l.assigned_to, st.kind, l.first_contacted_at,
           exists (select 1 from site_visits v where v.lead_id = l.id and v.status = 'done') visited
      from leads l join stages st on st.id = l.stage_id
     where l.ad_id is not null and (l.created_at at time zone 'Asia/Kolkata')::date between p_from and p_to
  ),
  per_ad as (
    select s.*, count(c.id) crm_leads, count(c.first_contacted_at) contacted, count(*) filter (where c.visited) visited,
           count(*) filter (where c.kind = 'won') won, count(*) filter (where c.kind = 'lost') lost
      from spend s left join crm c on c.ad_id = s.ad_id
     group by s.ad_id, s.account_id, s.account_name, s.campaign_id, s.campaign_name, s.adset_name, s.ad_name, s.currency,
              s.spend, s.impressions, s.clicks, s.meta_leads
  ),
  alloc as (  -- spend per CRM lead
    select c.*, s.spend / nullif(count(*) over (partition by c.ad_id), 0) cost
      from crm c join spend s on s.ad_id = c.ad_id
  ),
  agg as (
    select 'source' dim, coalesce(so.name, 'Not set') name, count(*) leads, count(a.first_contacted_at) contacted,
           count(*) filter (where a.visited) visited, count(*) filter (where a.kind = 'won') won, sum(a.cost) spend
      from alloc a left join sources so on so.id = a.source_id group by 2
    union all
    select 'project', coalesce(pj.name, 'Not set'), count(*), count(a.first_contacted_at), count(*) filter (where a.visited),
           count(*) filter (where a.kind = 'won'), sum(a.cost)
      from alloc a left join projects pj on pj.id = a.project_id group by 2
    union all
    select 'owner', coalesce(pr.full_name, 'Unassigned'), count(*), count(a.first_contacted_at), count(*) filter (where a.visited),
           count(*) filter (where a.kind = 'won'), sum(a.cost)
      from alloc a left join profiles pr on pr.id = a.assigned_to group by 2
  )
  select jsonb_build_object(
    'totals', (select jsonb_build_object('spend', coalesce(sum(spend), 0), 'impressions', coalesce(sum(impressions), 0), 'clicks', coalesce(sum(clicks), 0),
                                         'meta_leads', coalesce(sum(meta_leads), 0), 'crm_leads', coalesce(sum(crm_leads), 0), 'contacted', coalesce(sum(contacted), 0),
                                         'visited', coalesce(sum(visited), 0), 'won', coalesce(sum(won), 0), 'currency', max(currency),
                                         'unattributed_spend', coalesce(sum(spend) filter (where crm_leads = 0), 0)) from per_ad),
    'accounts', coalesce((select jsonb_agg(to_jsonb(x) order by x.spend desc) from (
        select account_id, max(account_name) name, sum(spend) spend, sum(impressions) impressions, sum(clicks) clicks, sum(meta_leads) meta_leads,
               sum(crm_leads) crm_leads, sum(contacted) contacted, sum(visited) visited, sum(won) won,
               (select so.name from crm c join sources so on so.id = c.source_id join spend s2 on s2.ad_id = c.ad_id
                 where s2.account_id = pa.account_id group by so.name order by count(*) desc limit 1) main_source
          from per_ad pa group by account_id) x), '[]'::jsonb),
    'campaigns', coalesce((select jsonb_agg(to_jsonb(x) order by x.spend desc) from (
        select campaign_id, max(campaign_name) name, max(account_name) account, sum(spend) spend, sum(clicks) clicks, sum(meta_leads) meta_leads,
               sum(crm_leads) crm_leads, sum(contacted) contacted, sum(visited) visited, sum(won) won
          from per_ad group by campaign_id) x), '[]'::jsonb),
    'ads', coalesce((select jsonb_agg(to_jsonb(x) order by x.spend desc) from (
        select ad_id, ad_name name, adset_name, campaign_name, account_name account, spend, clicks, meta_leads, crm_leads, contacted, visited, won, lost
          from per_ad order by spend desc limit 60) x), '[]'::jsonb),
    'by_source', coalesce((select jsonb_agg(to_jsonb(x) order by x.spend desc nulls last) from (select name, leads, contacted, visited, won, round(spend, 2) spend from agg where dim = 'source') x), '[]'::jsonb),
    'by_project', coalesce((select jsonb_agg(to_jsonb(x) order by x.spend desc nulls last) from (select name, leads, contacted, visited, won, round(spend, 2) spend from agg where dim = 'project') x), '[]'::jsonb),
    'by_owner', coalesce((select jsonb_agg(to_jsonb(x) order by x.leads desc) from (select name, leads, contacted, visited, won, round(spend, 2) spend from agg where dim = 'owner') x), '[]'::jsonb),
    'last_refresh', (select max(refreshed_at) from meta_ad_insights),
    'days_loaded', (select count(distinct day) from meta_ad_insights where day >= p_from and day <= p_to)
  ) into out;
  return out;
end $$;

grant execute on function public.in_lead_pool(uuid), public.touch_lead_view(uuid), public.lead_history(uuid, int),
  public.team_report(timestamptz, timestamptz), public.funnel_report(timestamptz, timestamptz, text),
  public.ads_report(date, date), public.rotation_preview(jsonb) to authenticated;
revoke execute on function private.claim_pool_lead(uuid, uuid, text), private.expire_pool(), private.rotate_idle(jsonb),
  private.idle_candidates(jsonb), private.fallback_owner() from public, anon, authenticated;
