\set ON_ERROR_STOP on
-- relies on fixtures and helpers created by tests/behaviour.sql
reset role;
set role authenticated;
select as_user('11111111-0000-0000-0000-000000000001');
select t_eq('admin dashboard counts all leads', (dashboard_stats(current_date - 30, current_date)->'totals'->>'leads')::int, (select count(*)::int from leads));
select t_eq('admin sees per-agent rows', jsonb_array_length(dashboard_stats(current_date - 30, current_date)->'by_agent') > 0, true);
select as_user('11111111-0000-0000-0000-000000000003');
select t_eq('agent dashboard counts only own leads', (dashboard_stats(current_date - 30, current_date)->'totals'->>'leads')::int, 2);
select t_eq('agent gets no per-agent breakdown', jsonb_array_length(dashboard_stats(current_date - 30, current_date)->'by_agent'), 0);
select as_user('11111111-0000-0000-0000-000000000005');
select t_eq('other team agent counts only their one lead', (dashboard_stats(current_date - 30, current_date)->'totals'->>'leads')::int, 1);
select as_user('11111111-0000-0000-0000-000000000006');
select t_eq('marketing gets aggregate totals', (dashboard_stats(current_date - 30, current_date)->'totals'->>'leads')::int > 0, true);
select t_eq('marketing has no agent rows', jsonb_array_length(dashboard_stats(current_date - 30, current_date)->'by_agent'), 0);
select t_eq('marketing has no overdue count', dashboard_stats(current_date - 30, current_date)->'overdue_followups', 'null'::jsonb);
select as_user('99999999-0000-0000-0000-000000000009');
select t_fails('non-staff user is refused', $$select dashboard_stats(current_date - 30, current_date)$$);
set role anon;
select t_fails('anon cannot call dashboard_stats', $$select dashboard_stats(current_date - 30, current_date)$$);
reset role;
\echo ALL TESTS PASSED
