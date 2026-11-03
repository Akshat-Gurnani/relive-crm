-- Relive CRM 0023: the dashboard also returns how many leads in each stage are hot, warm or cold. Cratio's Hot/Warm/Cold
-- "stages" were imported as stage Follow-up plus a temperature, so 2,111 of 2,712 open leads sit in Follow-up and the stage
-- bars alone say little.
do $$
declare def text := pg_get_functiondef('public.dashboard_stats'::regproc);
        old text := 'from (select stage_id, count(*) n from leads group by 1) s), ''[]''),';
        patched text;
begin
  patched := replace(def, old, old || E'\n    ''pipeline_temperature'', coalesce((select jsonb_agg(jsonb_build_object(''stage_id'', stage_id, ''temperature'', temperature, ''leads'', n)) from (select stage_id, temperature, count(*) n from leads group by 1, 2) s), ''[]''),');
  if patched = def then raise exception 'dashboard_stats did not contain the expected text'; end if;
  execute patched;
end $$;
