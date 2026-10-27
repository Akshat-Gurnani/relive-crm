\set ON_ERROR_STOP on
-- The writes the web app performs, run as each role. Relies on fixtures from tests/behaviour.sql.
reset role;
create or replace function t_rows(label text, stmt text, expected bigint) returns void language plpgsql as $$
declare n bigint;
begin
  execute stmt; get diagnostics n = row_count;
  if n is distinct from expected then raise exception 'FAIL % : % row(s) affected, expected %', label, n, expected; end if;
  raise notice 'ok   %', label;
end $$;

create temp table ctx as select
  (select l.id from leads l join people p on p.id=l.person_id where p.full_name='Ravi') as ravi,
  (select l.id from leads l join people p on p.id=l.person_id where p.full_name='Sita') as sita,
  (select l.id from leads l join people p on p.id=l.person_id where p.full_name='Mohan') as mohan,
  (select id from stages where name='Lost') as lost,
  (select id from stages where name='Site Visit Scheduled') as visit_sched,
  (select id from stages where name='Booked') as won,
  (select id from lost_reasons where name='Not interested') as reason;
grant select on ctx to authenticated;
set role authenticated;

-- agent A1 owns Ravi
select as_user('11111111-0000-0000-0000-000000000003');
select t_rows('agent logs a call', $$insert into activities(lead_id,type,outcome,notes,assigned_to,created_by,completed_at)
   select ravi,'call','Connected, interested','spoke',auth.uid(),auth.uid(),now() from ctx$$, 1);
select t_eq('call stamps first contact', (select first_contacted_at is not null from leads where id=(select ravi from ctx)), true);
select t_rows('agent sets follow-up', $$update leads set next_followup_at=now()+interval '1 day', next_followup_note='send brochure', last_activity_at=now() where id=(select ravi from ctx)$$, 1);
select t_fails('lost needs a reason', format('update leads set stage_id=%L where id=%L', (select lost from ctx), (select mohan from ctx)));
select t_rows('lost with reason works', $$update leads set stage_id=(select lost from ctx), lost_reason_id=(select reason from ctx), next_followup_at=null where id=(select mohan from ctx)$$, 1);
select t_eq('lost stamps lost_at', (select lost_at is not null from leads where id=(select mohan from ctx)), true);
select t_eq('stage history written', (select count(*) from lead_stage_history where lead_id=(select mohan from ctx) and to_stage_id=(select lost from ctx)), 1::bigint);
select t_fails('agent cannot reassign', format('update leads set assigned_to=%L where id=%L', '11111111-0000-0000-0000-000000000004', (select ravi from ctx)));
select t_rows('agent cannot touch another agent lead', $$update leads set temperature='hot' where id=(select sita from ctx)$$, 0);
select t_rows('agent schedules a visit', $$insert into site_visits(lead_id,scheduled_at) select ravi, now()+interval '2 days' from ctx$$, 1);
select t_rows('agent marks visit done', $$update site_visits set done_at=now(), accompanied_by=auth.uid() where lead_id=(select ravi from ctx)$$, 1);

-- manager A may reassign inside their team
select as_user('11111111-0000-0000-0000-000000000002');
select t_rows('manager reassigns within team', $$update leads set assigned_to='11111111-0000-0000-0000-000000000004' where id=(select sita from ctx)$$, 1);
select t_eq('reassignment visible', (select assigned_to from leads where id=(select sita from ctx)), '11111111-0000-0000-0000-000000000004'::uuid);

-- the filters the leads page builds
select as_user('11111111-0000-0000-0000-000000000001');
select t_eq('search by phone fragment', (select count(*) from leads l join people p on p.id=l.person_id where p.phone_e164 ilike '%9984429770%'), 1::bigint);
select t_eq('search by name fragment', (select count(*) from leads l join people p on p.id=l.person_id where p.full_name ilike '%sit%'), 1::bigint);

-- marketing cannot use the work screens' tables
select as_user('11111111-0000-0000-0000-000000000006');
select t_eq('marketing cannot log activity', (select count(*) from activities), 0::bigint);
select t_fails('marketing cannot insert activity', format('insert into activities(lead_id,type) values (%L,%L)', (select ravi from ctx), 'note'));
reset role;
\echo ALL TESTS PASSED
