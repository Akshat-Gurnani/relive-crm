-- Relive CRM 0015: routing lists. Which reps get which leads is now a set of editable rules instead of one team per Page.
--   * A rule says "leads from THESE forms / campaigns / ad sets / ads / THIS project / names containing X go to THIS ordered
--     list of reps". The most specific rule wins; ties go to the lower position.
--   * Inside a rule the reps rotate evenly by default. A rep's "share" (1 for everybody unless you change it) gives a
--     percentage-style split: shares 50/30/20 hand out leads in that ratio. Switch a rep off to skip them (leave, sick day).
--   * A rule can also set the project, lead source and priority of the leads it catches.
--   * Edits apply to leads that arrive after you save. Old leads never move.
--   * A person who enquires again keeps their open lead with the rep who owns it, whatever the project or ad. If the project
--     differs, or the earlier lead was already won or lost, the rep gets a loud alert and the lead carries an attention note
--     until they acknowledge it.
--   * The 30-minute "not called yet" rotation now passes a lead to the next rep in the same list.

create table routing_rules (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  active boolean not null default true,
  position int not null default 100,
  endpoint_id uuid references capture_endpoints(id) on delete cascade,
  form_ids text[] not null default '{}',
  campaign_ids text[] not null default '{}',
  adset_ids text[] not null default '{}',
  ad_ids text[] not null default '{}',
  name_contains text,
  match_project_id uuid references projects(id) on delete cascade,
  set_project_id uuid references projects(id) on delete set null,
  set_source_id uuid references sources(id) on delete set null,
  set_priority text check (set_priority in ('High', 'Medium', 'Low')),
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table routing_members (
  rule_id uuid not null references routing_rules(id) on delete cascade,
  user_id uuid not null references profiles(id) on delete cascade,
  position int not null default 0,
  share numeric not null default 1 check (share > 0),
  active boolean not null default true,
  served int not null default 0,
  last_at timestamptz,
  primary key (rule_id, user_id)
);
create index routing_members_user_idx on routing_members(user_id);

alter table leads
  add column routing_rule_id uuid references routing_rules(id) on delete set null,
  add column attention text,
  add column attention_at timestamptz;

-- A rep who is added (or switched back on) starts level with the others instead of receiving a catch-up flood.
create or replace function private.routing_member_level() returns trigger
language plpgsql security definer set search_path = public as $$
declare v numeric;
begin
  if tg_op = 'UPDATE' and not (new.active and not old.active) then return new; end if;
  select min(m.served / m.share) into v from routing_members m
   where m.rule_id = new.rule_id and m.active and m.user_id <> new.user_id;
  if v is not null then new.served := greatest(new.served, floor(v * new.share)::int); end if;
  return new;
end $$;
create trigger routing_members_level before insert or update on routing_members
  for each row execute function private.routing_member_level();

alter table routing_rules enable row level security;
alter table routing_members enable row level security;
create policy routing_rules_read on routing_rules for select to authenticated using (public.app_current_role() in ('admin', 'manager'));
create policy routing_rules_write on routing_rules for all to authenticated
  using (public.app_current_role() = 'admin') with check (public.app_current_role() = 'admin');
create policy routing_members_read on routing_members for select to authenticated using (public.app_current_role() in ('admin', 'manager'));
create policy routing_members_write on routing_members for all to authenticated
  using (public.app_current_role() = 'admin') with check (public.app_current_role() = 'admin');

-- the rule that catches this lead: most specific first (ad, ad set, campaign, form, name, project), then position
create or replace function public.match_rule(p jsonb, p_endpoint uuid, p_project uuid) returns uuid
language sql stable security definer set search_path = public as $$
  select r.id from routing_rules r
   where r.active
     and (r.endpoint_id is null or r.endpoint_id = p_endpoint)
     and (cardinality(r.form_ids) = 0 or (p ->> 'form_id') = any (r.form_ids))
     and (cardinality(r.campaign_ids) = 0 or (p ->> 'campaign_id') = any (r.campaign_ids))
     and (cardinality(r.adset_ids) = 0 or (p ->> 'adset_id') = any (r.adset_ids))
     and (cardinality(r.ad_ids) = 0 or (p ->> 'ad_id') = any (r.ad_ids))
     and (r.name_contains is null or upper(concat_ws(' ', p ->> 'form_name', p ->> 'campaign_name', p ->> 'adset_name', p ->> 'ad_name'))
                                      like '%' || upper(btrim(r.name_contains)) || '%')
     and (r.match_project_id is null or r.match_project_id = p_project)
   order by (case when cardinality(r.ad_ids) > 0 then 32 else 0 end + case when cardinality(r.adset_ids) > 0 then 16 else 0 end
           + case when cardinality(r.campaign_ids) > 0 then 8 else 0 end + case when cardinality(r.form_ids) > 0 then 4 else 0 end
           + case when r.name_contains is not null then 2 else 0 end + case when r.match_project_id is not null then 1 else 0 end) desc,
            r.position, r.created_at
   limit 1
$$;

-- the next rep in a rule: the one furthest behind their share, never the person named in p_except
create or replace function public.pick_from_rule(p_rule uuid, p_except uuid default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare v uuid;
begin
  perform 1 from routing_rules where id = p_rule for update;
  select m.user_id into v from routing_members m join profiles pr on pr.id = m.user_id
   where m.rule_id = p_rule and m.active and pr.active and pr.accepting_leads and m.user_id is distinct from p_except
   order by m.served / m.share, m.position, m.user_id
   limit 1;
  if v is not null then
    update routing_members set served = served + 1, last_at = clock_timestamp() where rule_id = p_rule and user_id = v;
    update profiles set last_assigned_at = clock_timestamp() where id = v;
  end if;
  return v;
end $$;

-- admin "test a lead": which rule would catch it and who would be next, without handing anything out
create or replace function public.preview_route(p jsonb, p_project uuid default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_rule uuid; r routing_rules%rowtype; v_next uuid;
begin
  if public.app_current_role() is distinct from 'admin' then raise exception 'only admins can test routing' using errcode = '42501'; end if;
  v_rule := public.match_rule(p, null, coalesce(p_project, public.project_from_text(concat_ws(' ', p ->> 'form_name', p ->> 'campaign_name', p ->> 'adset_name'))));
  if v_rule is null then return jsonb_build_object('rule', null); end if;
  select * into r from routing_rules where id = v_rule;
  select m.user_id into v_next from routing_members m join profiles pr on pr.id = m.user_id
   where m.rule_id = v_rule and m.active and pr.active and pr.accepting_leads
   order by m.served / m.share, m.position, m.user_id limit 1;
  return jsonb_build_object('rule', r.name, 'rule_id', r.id, 'next', (select full_name from profiles where id = v_next),
                            'project', (select name from projects where id = coalesce(r.set_project_id, public.project_from_text(concat_ws(' ', p ->> 'form_name', p ->> 'campaign_name', p ->> 'adset_name')))),
                            'priority', r.set_priority);
end $$;

create or replace function public.ack_attention(p_lead uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  update leads set attention = null, attention_at = null
   where id = p_lead and (assigned_to = auth.uid() or public.app_current_role() in ('admin', 'manager'));
end $$;

revoke all on function public.match_rule(jsonb, uuid, uuid), public.pick_from_rule(uuid, uuid) from public, anon, authenticated;
grant execute on function public.match_rule(jsonb, uuid, uuid), public.pick_from_rule(uuid, uuid) to service_role;
revoke all on function public.preview_route(jsonb, uuid), public.ack_attention(uuid) from public, anon;
grant execute on function public.preview_route(jsonb, uuid), public.ack_attention(uuid) to authenticated;

-- the 30-minute rotation passes a lead on inside its own list (leads without a list keep the old team rule)
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

-- ingest_lead: 0013's version plus routing lists and cross-project re-enquiries
create or replace function public.ingest_lead(p_endpoint uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  ep capture_endpoints%rowtype;
  rl routing_rules%rowtype;
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

  -- routing list: the most specific active rule; what it sets wins over what the names say
  v_rule := public.match_rule(p, ep.id, v_project);
  if v_rule is not null then
    select * into rl from routing_rules where id = v_rule;
    v_source := coalesce(rl.set_source_id, v_source);
    v_project := coalesce(rl.set_project_id, v_project);
  end if;
  v_priority := coalesce(rl.set_priority, ep.default_priority, 'Medium');
  v_ad := nullif(coalesce(p ->> 'ad_name', p ->> 'form_name', p ->> 'campaign_name'), '');

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

  -- an open lead of this person, in ANY project, stays with the rep who has it
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
    -- the owner is told loudly; an ownerless or inactive owner's lead goes back through the list
    if v_owner is not null and exists (select 1 from profiles where id = v_owner and active) then
      perform public.notify(v_owner, 'reenquiry', 'ATTENTION: your lead enquired again', public.lead_label(v_lead) || ' · ' || v_attn, v_lead);
    else
      v_assignee := case when v_rule is not null then public.pick_from_rule(v_rule) else public.pick_assignee(ep.team_id) end;
      if v_assignee is not null then
        update leads set assigned_to = v_assignee, routing_rule_id = coalesce(v_rule, routing_rule_id) where id = v_lead;
        perform public.notify(v_assignee, 'reenquiry', 'ATTENTION: lead enquired again', public.lead_label(v_lead) || ' · ' || v_attn, v_lead);
      else
        perform public.notify(pr.id, 'lead_unassigned', 'Re-enquiry on a lead with no owner', public.lead_label(v_lead), v_lead)
           from profiles pr where pr.role = 'admin' and pr.active;
      end if;
    end if;
  else
    select id into v_stage from stages where is_default;
    if v_rule is not null then
      v_assignee := public.pick_from_rule(v_rule);
    end if;
    if v_assignee is null and v_rule is null then
      select id into v_assignee from profiles where id = ep.assign_to and active;
      v_assignee := coalesce(v_assignee, public.pick_assignee(ep.team_id));
    end if;
    -- a person who bought or was lost earlier comes back as a new lead, marked so the new rep knows the history
    select l.id, s.name sname, s.kind skind, l.created_at, (select name from projects where id = l.project_id) pname,
           (select full_name from profiles where id = l.assigned_to) oname
      into v_prev from leads l join stages s on s.id = l.stage_id
     where l.person_id = v_person and s.kind <> 'open' order by l.stage_changed_at desc nulls last, l.created_at desc limit 1;
    if v_prev.sname is not null then
      v_attn := 'Returning enquiry: earlier lead was ' || v_prev.sname || coalesce(' for ' || v_prev.pname, '') || coalesce(' with ' || v_prev.oname, '')
                || ' (' || to_char(v_prev.created_at at time zone 'Asia/Kolkata', 'DD Mon YYYY') || ')' || coalesce(' · ad: ' || v_ad, '');
    end if;
    insert into leads(person_id, project_id, source_id, stage_id, assigned_to, next_followup_at, created_at, description,
                      vendor_id, provider, campaign_id, campaign_name, adset_id, adset_name, ad_id, ad_name,
                      form_id, form_name, platform, priority, routing_rule_id, attention, attention_at)
    values (v_person, v_project, v_source, v_stage, v_assignee, now(), v_received, v_answer,
            ep.vendor_id, v_provider, p ->> 'campaign_id', p ->> 'campaign_name', p ->> 'adset_id', p ->> 'adset_name',
            p ->> 'ad_id', p ->> 'ad_name', p ->> 'form_id', p ->> 'form_name', p ->> 'platform',
            v_priority, v_rule, v_attn, case when v_attn is not null then now() end)
    returning id into v_lead;
    perform public.apply_answers(v_lead, v_answers);
    v_label := public.lead_label(v_lead);
    if v_attn is not null and v_assignee is not null then
      perform public.notify(v_assignee, 'reenquiry', 'ATTENTION: returning customer', v_label || ' · ' || v_attn, v_lead);
    end if;
    if v_assignee is null then
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
          || coalesce(' · ' || nullif(p ->> 'form_name', ''), '') || coalesce(' · list: ' || rl.name, ''));

  return jsonb_build_object('status', 'processed', 'reenquiry', v_re,
                            'person_id', v_person, 'lead_id', v_lead, 'enquiry_id', v_enq,
                            'endpoint_id', ep.id, 'rule', rl.name,
                            'assigned_to', (select assigned_to from leads where id = v_lead));
end $$;
revoke all on function public.ingest_lead(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.ingest_lead(uuid, jsonb) to service_role;
