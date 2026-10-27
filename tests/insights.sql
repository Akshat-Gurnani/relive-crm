\set ON_ERROR_STOP on
-- 0011 search and 0012 AI Insights. Fixtures from tests/behaviour.sql: admin ...0001, Manager A ...0002, Agent A1 ...0003.
reset role;
select t_eq('search index covers every lead', (select count(*) from lead_search), (select count(*) from leads));
update profiles set full_name = full_name || ' Renamed' where id = '11111111-0000-0000-0000-000000000003';
select t_eq('renaming staff updates search', (select count(*) > 0 from lead_search s join leads l on l.id = s.lead_id
  where l.assigned_to = '11111111-0000-0000-0000-000000000003' and s.search_text like '%renamed%'), true);
update profiles set full_name = replace(full_name, ' Renamed', '') where id = '11111111-0000-0000-0000-000000000003';

set role authenticated;
select as_user('11111111-0000-0000-0000-000000000003');
select t_fails('agent cannot open AI Insights', 'select public.insights_snapshot(null, null)');
select t_eq('agent sees no AI questions', (select count(*) from ai_queries), 0::bigint);
select t_fails('agent cannot log an AI question', $q$insert into ai_queries(question) values ('hello')$q$);
select t_eq('agent search only finds own leads', (select count(*) from lead_search), (select count(*) from leads));
select as_user('11111111-0000-0000-0000-000000000002');
select t_fails('team leader cannot open AI Insights', 'select public.insights_snapshot(null, null)');
select as_user('11111111-0000-0000-0000-000000000001');
select t_eq('admin gets totals', (select (public.insights_snapshot(null, null) -> 'totals' ->> 'n')::bigint), (select count(*) from leads where not ('Demo' = any(tags))));
select t_eq('admin snapshot has no phone numbers', (select public.insights_snapshot(null, null)::text ~ '\+91\d{10}'), false);
insert into ai_queries(question, answer) values ('test question', 'test answer');
select t_eq('admin question logged', (select count(*) from ai_queries where question = 'test question'), 1::bigint);
select as_user(null);
reset role;
delete from ai_queries where question = 'test question';
do $$ begin raise notice 'ALL INSIGHTS TESTS PASSED'; end $$;
