\set ON_ERROR_STOP on
-- 0004: visibility through the reporting chain. Uses the fixtures from tests/behaviour.sql:
-- Team A: Manager A (mgra), Agent A1, Agent A2. Team B: Manager B (mgrb), Agent B1.
reset role;
create temp table h as select
  '11111111-0000-0000-0000-000000000002'::uuid as mgra,
  '11111111-0000-0000-0000-000000000003'::uuid as a1,
  '11111111-0000-0000-0000-000000000004'::uuid as a2,
  '11111111-0000-0000-0000-000000000005'::uuid as b1,
  '11111111-0000-0000-0000-000000000007'::uuid as mgrb;
grant select on h to authenticated;
insert into people(phone_e164, full_name) values ('+917700000801', 'Hier A2 lead'), ('+917700000802', 'Hier B1 lead'), ('+917700000803', 'Hier A1 lead');
insert into leads(person_id, project_id, stage_id, assigned_to)
  select id, 'bbbbbbbb-0000-0000-0000-000000000001', (select id from stages where is_default), (select a2 from h) from people where full_name = 'Hier A2 lead';
insert into leads(person_id, project_id, stage_id, assigned_to)
  select id, 'bbbbbbbb-0000-0000-0000-000000000002', (select id from stages where is_default), (select b1 from h) from people where full_name = 'Hier B1 lead';
insert into leads(person_id, project_id, stage_id, assigned_to)
  select id, 'bbbbbbbb-0000-0000-0000-000000000001', (select id from stages where is_default), (select a1 from h) from people where full_name = 'Hier A1 lead';
insert into attendance(user_id, kind) select b1, 'in' from h;

-- Before any reporting lines: the 0001 team rules still hold.
set role authenticated;
select as_user((select a1 from h));
select t_eq('no chain: agent A1 cannot see A2''s lead', (select count(*) from leads l join people p on p.id = l.person_id where p.full_name = 'Hier A2 lead'), 0::bigint);
select as_user((select mgra from h));
select t_eq('no chain: manager A sees own team', (select count(*) from leads l join people p on p.id = l.person_id where p.full_name = 'Hier A2 lead'), 1::bigint);
select t_eq('no chain: manager A cannot see team B', (select count(*) from leads l join people p on p.id = l.person_id where p.full_name = 'Hier B1 lead'), 0::bigint);

-- Reporting lines: A2 reports to A1 (a sub-lead), B1 reports to Manager B, Manager B reports to Manager A (a head over two teams).
reset role;
update profiles set manager_id = (select a1 from h) where id = (select a2 from h);
update profiles set manager_id = (select mgrb from h) where id = (select b1 from h);
update profiles set manager_id = (select mgra from h) where id = (select mgrb from h);
set role authenticated;

select as_user((select a1 from h));
select t_eq('sub-lead A1 sees A2''s lead', (select count(*) from leads l join people p on p.id = l.person_id where p.full_name = 'Hier A2 lead'), 1::bigint);
select t_eq('sub-lead A1 sees A2''s profile', (select count(*) from profiles where id = (select a2 from h)), 1::bigint);
select t_eq('sub-lead A1 still cannot see team B', (select count(*) from leads l join people p on p.id = l.person_id where p.full_name = 'Hier B1 lead'), 0::bigint);
select as_user((select a2 from h));
select t_eq('A2 does not see upward (A1''s lead)', (select count(*) from leads l join people p on p.id = l.person_id where p.full_name = 'Hier A1 lead'), 0::bigint);

select as_user((select mgra from h));
select t_eq('head sees a lead two levels down in another team', (select count(*) from leads l join people p on p.id = l.person_id where p.full_name = 'Hier B1 lead'), 1::bigint);
select t_eq('head sees that agent''s attendance', (select count(*) from attendance where user_id = (select b1 from h)), 1::bigint);
select t_eq('head sees Manager B and Agent B1 in staff', (select count(*) from profiles where id in ((select b1 from h), (select mgrb from h))), 2::bigint);
select t_eq('head can see person details of that lead', (select count(*) from people where full_name = 'Hier B1 lead'), 1::bigint);

select as_user((select mgrb from h));
select t_eq('Manager B does not see upward into team A', (select count(*) from leads l join people p on p.id = l.person_id where p.full_name = 'Hier A2 lead'), 0::bigint);
select t_eq('Manager B still sees own team', (select count(*) from leads l join people p on p.id = l.person_id where p.full_name = 'Hier B1 lead'), 1::bigint);

-- Reassigning: a sub-lead may move leads between themselves and their reports, nowhere else.
select as_user((select a1 from h));
update leads set assigned_to = (select a1 from h) where person_id = (select id from people where full_name = 'Hier A2 lead');
reset role;
select t_eq('sub-lead takes back a report''s lead', (select assigned_to from leads where person_id = (select id from people where full_name = 'Hier A2 lead')), (select a1 from h));
set role authenticated;
select as_user((select a1 from h));
update leads set assigned_to = (select a2 from h) where person_id = (select id from people where full_name = 'Hier A2 lead');
reset role;
select t_eq('sub-lead hands it back to the report', (select assigned_to from leads where person_id = (select id from people where full_name = 'Hier A2 lead')), (select a2 from h));
set role authenticated;
select as_user((select a1 from h));
select t_fails('sub-lead cannot give a lead outside their line', format($$update leads set assigned_to = %L where person_id = (select id from people where full_name = 'Hier A1 lead')$$, (select b1 from h)));
select as_user((select a2 from h));
select t_fails('report cannot reassign to their lead', format($$update leads set assigned_to = %L where person_id = (select id from people where full_name = 'Hier A2 lead')$$, (select a1 from h)));

-- No loops in the reporting line.
reset role;
select t_fails('cannot report to yourself', format($$update profiles set manager_id = id where id = %L$$, (select a1 from h)));
select t_fails('cannot report to someone below you', format($$update profiles set manager_id = %L where id = %L$$, (select b1 from h), (select mgra from h)));

-- Deactivated people drop out of the chain.
update profiles set active = false where id = (select mgrb from h);
set role authenticated;
select as_user((select mgra from h));
select t_eq('chain stops at a deactivated manager', (select count(*) from leads l join people p on p.id = l.person_id where p.full_name = 'Hier B1 lead'), 0::bigint);

-- Clean up so later test files see the original fixtures.
reset role;
update profiles set active = true where id = (select mgrb from h);
update profiles set manager_id = null where id in ((select a2 from h), (select b1 from h), (select mgrb from h));
select as_user(null);
do $$ begin raise notice 'ALL HIERARCHY TESTS PASSED'; end $$;
