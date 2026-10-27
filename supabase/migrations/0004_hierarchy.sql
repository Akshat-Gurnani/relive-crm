-- Relive CRM 0004: visibility follows the reporting chain as well as the team.
-- Anyone sees their own leads plus the leads of everyone who reports to them, directly or further down
-- (profiles.manager_id, "Reports to" in Admin, Staff). Team leaders keep everything 0001 gave them, so
-- nobody loses access: a sales head over several teams, or a team leader with a sub-lead, simply sees more.

-- Everyone below the signed-in person in the reporting chain (not including themselves). Depth-capped and
-- cycle-safe, and evaluated once per statement rather than once per row.
create or replace function public.my_reports() returns uuid[]
language sql stable security definer set search_path = public as $$
  with recursive tree(id, depth, path) as (
    select p.id, 1, array[p.id] from profiles p where p.manager_id = auth.uid() and p.active
    union all
    select p.id, t.depth + 1, t.path || p.id
      from profiles p join tree t on p.manager_id = t.id
     where p.active and t.depth < 10 and not p.id = any(t.path)
  )
  select coalesce(array_agg(distinct id), '{}') from tree where id <> auth.uid()
$$;

create or replace function public.reports_to_me(p_user uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select p_user is not null and p_user = any(public.my_reports())
$$;

-- A person cannot report to themselves or to anyone below them.
create or replace function public.profiles_no_cycle() returns trigger
language plpgsql security definer set search_path = public as $$
declare cur uuid := new.manager_id; n int := 0;
begin
  while cur is not null and n < 20 loop
    if cur = new.id then raise exception 'reporting line would loop back to %', new.full_name; end if;
    select manager_id into cur from profiles where id = cur;
    n := n + 1;
  end loop;
  return new;
end $$;
drop trigger if exists profiles_no_cycle on profiles;
create trigger profiles_no_cycle before insert or update of manager_id on profiles
  for each row when (new.manager_id is not null) execute function public.profiles_no_cycle();

create index if not exists profiles_manager_idx on profiles(manager_id);

-- Leads: own, anyone below me, plus the team rules from 0001 for managers.
create or replace function public.can_see_lead(p_assigned uuid, p_project uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(case public.app_current_role()
    when 'admin' then true
    when 'agent' then p_assigned = auth.uid() or public.reports_to_me(p_assigned)
    when 'manager' then
      p_assigned = auth.uid()
      or public.reports_to_me(p_assigned)
      or (p_assigned is not null and public.app_current_team() is not null and exists (
           select 1 from profiles a where a.id = p_assigned and a.team_id = public.app_current_team()))
      or (p_assigned is null and p_project is not null and exists (
           select 1 from team_projects tp where tp.team_id = public.app_current_team() and tp.project_id = p_project))
    else false end, false)
$$;

-- Tasks, attendance and location of people I lead (team or reporting chain).
create or replace function public.in_my_team(p_user uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.app_current_role() = 'admin'
      or public.reports_to_me(p_user)
      or (public.app_current_role() = 'manager' and exists (
            select 1 from profiles where id = p_user and team_id = public.app_current_team()))
$$;

alter policy profiles_read on profiles using (
  id = auth.uid()
  or public.app_current_role() = 'admin'
  or public.reports_to_me(id)
  or (public.app_current_role() = 'manager' and team_id = public.app_current_team()));

-- Someone with people under them may reassign leads among those people even without the manager role.
create or replace function public.leads_before_update() returns trigger
language plpgsql security definer set search_path = public as $$
declare k stage_kind; r app_role;
begin
  r := public.app_current_role();
  if auth.uid() is not null and new.assigned_to is distinct from old.assigned_to
     and coalesce(r::text, '') not in ('admin', 'manager')
     and not ((new.assigned_to = auth.uid() or public.reports_to_me(new.assigned_to))
              and (old.assigned_to = auth.uid() or public.reports_to_me(old.assigned_to))
              and (public.reports_to_me(new.assigned_to) or public.reports_to_me(old.assigned_to))) then
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

revoke all on function public.my_reports(), public.reports_to_me(uuid) from public, anon;
grant execute on function public.my_reports(), public.reports_to_me(uuid) to authenticated;
