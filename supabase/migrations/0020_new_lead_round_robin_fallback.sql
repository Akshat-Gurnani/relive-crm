-- Relive CRM 0020: new leads from capture endpoints (Facebook etc.) with no routing list and no team used to arrive with no
-- owner, while the admin screen said they go round robin. This adds the promised fallback for NEW captured leads only.
-- pick_assignee is left untouched because the rotation job, CSV import and manual add also use it.
create or replace function public.pick_lead_owner(p_team uuid) returns uuid
language plpgsql security definer set search_path to 'public' as $$
declare v uuid;
begin
  if p_team is not null then return public.pick_assignee(p_team); end if;
  select id into v from profiles
   where role = 'agent' and active and accepting_leads
   order by last_assigned_at nulls first, created_at
   limit 1 for update skip locked;
  if v is not null then update profiles set last_assigned_at = clock_timestamp() where id = v; end if;
  return v;
end $$;

do $$
declare def text := pg_get_functiondef('public.ingest_lead'::regproc);
        patched text;
begin
  patched := replace(def, 'public.pick_assignee(ep.team_id)', 'public.pick_lead_owner(ep.team_id)');
  if patched = def then raise exception 'ingest_lead did not contain the expected call'; end if;
  execute patched;
end $$;
