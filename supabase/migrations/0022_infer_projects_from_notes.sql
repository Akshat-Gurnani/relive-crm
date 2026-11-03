-- Relive CRM 0022: project on leads that have none.
-- The imported Cratio "Product Category" on projectless leads holds a campaign tag (LPM 75 LAC), property types and list tags,
-- never a project, so the project was not recorded and cannot be inferred from it. 176 leads name exactly one project in their
-- notes; those get that project. Provenance is kept in leads.legacy.project_inferred_from so it can be undone:
--   update leads set project_id = null, legacy = legacy - 'project_inferred_from' where legacy ->> 'project_inferred_from' = 'agent notes';
with names as (
  select p.id, lower(x) term from projects p, lateral unnest(array[p.name] || coalesce(p.aliases, '{}')) x
   where p.active and length(x) >= 5
), hits as (
  select distinct l.id lead_id, nm.id project_id
    from leads l join lead_notes nt on nt.lead_id = l.id
    join names nm on lower(nt.body) like '%' || nm.term || '%'
   where l.project_id is null
), one as (
  select lead_id, (array_agg(project_id))[1] project_id from hits group by lead_id having count(distinct project_id) = 1
)
update leads l set project_id = one.project_id,
       legacy = coalesce(l.legacy, '{}'::jsonb) || jsonb_build_object('project_inferred_from', 'agent notes')
  from one where l.id = one.lead_id;

-- The dashboard also reports how many projectless leads in the period came from the LPM event campaign (it covers many projects).
do $$
declare def text := pg_get_functiondef('public.dashboard_stats'::regproc);
        patched text;
begin
  patched := replace(def, '''overdue_followups'', (select count(*) from leads l join stages s',
    '''no_project_event'', (select count(*) from leads where project_id is null and created_at >= p_from and created_at < p_to + 1 and (legacy ->> ''Product Category'' ilike ''%LPM%'' or legacy ->> ''Product Category'' ilike ''%LMP%'')), ''overdue_followups'', (select count(*) from leads l join stages s');
  if patched = def then raise exception 'dashboard_stats did not contain the expected text'; end if;
  execute patched;
end $$;
