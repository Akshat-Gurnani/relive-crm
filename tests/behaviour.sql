\set ON_ERROR_STOP on
create or replace function t_eq(label text, actual anyelement, expected anyelement) returns void language plpgsql as $$
begin
  if actual is distinct from expected then raise exception 'FAIL % : got %, expected %', label, actual, expected; end if;
  raise notice 'ok   %', label;
end $$;
create or replace function t_fails(label text, stmt text) returns void language plpgsql as $$
begin
  begin execute stmt; exception when others then raise notice 'ok   % (blocked: %)', label, sqlerrm; return; end;
  raise exception 'FAIL % : statement succeeded but should have been blocked', label;
end $$;
create or replace function as_user(u uuid) returns void language plpgsql as $$
begin perform set_config('request.jwt.claim.sub', coalesce(u::text,''), false); end $$;

-- fixtures (superuser)
insert into teams(id,name) values ('aaaaaaaa-0000-0000-0000-000000000001','Team A'),('aaaaaaaa-0000-0000-0000-000000000002','Team B');
insert into auth.users(id,email) values
 ('11111111-0000-0000-0000-000000000001','admin@x'),('11111111-0000-0000-0000-000000000002','mgra@x'),
 ('11111111-0000-0000-0000-000000000003','a1@x'),('11111111-0000-0000-0000-000000000004','a2@x'),
 ('11111111-0000-0000-0000-000000000005','b1@x'),('11111111-0000-0000-0000-000000000006','mkt@x'),
 ('11111111-0000-0000-0000-000000000007','mgrb@x');
insert into profiles(id,full_name,role,team_id) values
 ('11111111-0000-0000-0000-000000000001','Admin','admin',null),
 ('11111111-0000-0000-0000-000000000002','Manager A','manager','aaaaaaaa-0000-0000-0000-000000000001'),
 ('11111111-0000-0000-0000-000000000003','Agent A1','agent','aaaaaaaa-0000-0000-0000-000000000001'),
 ('11111111-0000-0000-0000-000000000004','Agent A2','agent','aaaaaaaa-0000-0000-0000-000000000001'),
 ('11111111-0000-0000-0000-000000000005','Agent B1','agent','aaaaaaaa-0000-0000-0000-000000000002'),
 ('11111111-0000-0000-0000-000000000006','Marketing','marketing',null),
 ('11111111-0000-0000-0000-000000000007','Manager B','manager','aaaaaaaa-0000-0000-0000-000000000002');
update profiles set created_at = now() - interval '3 days' where full_name='Agent A1';
update profiles set created_at = now() - interval '2 days' where full_name='Agent A2';
insert into projects(id,name) values ('bbbbbbbb-0000-0000-0000-000000000001','Project One'),('bbbbbbbb-0000-0000-0000-000000000002','Project Two');
insert into team_projects values ('aaaaaaaa-0000-0000-0000-000000000001','bbbbbbbb-0000-0000-0000-000000000001'),
                                 ('aaaaaaaa-0000-0000-0000-000000000002','bbbbbbbb-0000-0000-0000-000000000002');
insert into capture_endpoints(slug,name,source_id,project_id,team_id,secret_hash)
 select 'one','One',(select id from sources where name='Facebook Lead Ads'),'bbbbbbbb-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000001','h1';

-- phone normalisation
select t_eq('phone 10 digit', normalize_phone('9984429770'), '+919984429770');
select t_eq('phone +91 spaced', normalize_phone('+91 99844-29770'), '+919984429770');
select t_eq('phone 12 digit', normalize_phone('919984429770'), '+919984429770');
select t_eq('phone leading zero', normalize_phone('09984429770'), '+919984429770');
select t_eq('phone 00 prefix intl', normalize_phone('00971501234567'), '+971501234567');
select t_eq('phone sci notation rejected', normalize_phone('9.19984E+11'), null::text);
select t_eq('phone too short rejected', normalize_phone('12345'), null::text);
select t_eq('phone landline-ish rejected', normalize_phone('5512345678'), null::text);

-- capture as service role
set role service_role;
select t_eq('capture 1 status', (capture_enquiry('one','h1','{"contact":"Ravi","mobile":"9984429770","city":"Lucknow","category":"Yes","date":"2026-10-05T18:19:00+00:00"}'))->>'status', 'processed');
select t_eq('lead 1 to oldest agent', (select full_name from profiles where id=(select assigned_to from leads order by created_at limit 1)), 'Agent A1');
select capture_enquiry('one','h1','{"contact":"Sita","mobile":"+91 98765 43210"}');
select t_eq('lead 2 to next agent', (select full_name from profiles where id=(select assigned_to from leads l join people p on p.id=l.person_id where p.full_name='Sita')), 'Agent A2');
select capture_enquiry('one','h1','{"contact":"Mohan","mobile":"9876500001"}');
select t_eq('round robin wraps to first agent', (select full_name from profiles where id=(select assigned_to from leads l join people p on p.id=l.person_id where p.full_name='Mohan')), 'Agent A1');
-- re-enquiry with different formatting of the same number
select t_eq('re-enquiry flagged', (capture_enquiry('one','h1','{"contact":"Ravi K","mobile":"+919984429770","category":"Again"}'))->>'reenquiry', 'true');
select t_eq('no duplicate person', (select count(*) from people), 3::bigint);
select t_eq('no duplicate lead', (select count(*) from leads), 3::bigint);
select t_eq('reenquiry counted', (select reenquiry_count from leads l join people p on p.id=l.person_id where p.phone_e164='+919984429770'), 1);
select t_eq('reenquiry activity logged', (select count(*) from activities where type='re_enquiry'), 1::bigint);
select t_eq('every enquiry kept', (select count(*) from enquiries), 4::bigint);
select t_eq('first name kept', (select full_name from people where phone_e164='+919984429770'), 'Ravi');
select t_eq('invalid phone stored not lost', (capture_enquiry('one','h1','{"contact":"Bad","mobile":"123"}'))->>'status', 'invalid_phone');
select t_eq('invalid enquiry row exists', (select count(*) from enquiries where status='invalid_phone'), 1::bigint);
select t_eq('retried delivery ignored', (capture_enquiry('one','h1','{"contact":"Mohan","mobile":"9876500001"}'))->>'status', 'duplicate_delivery');
select t_eq('retry did not add enquiry', (select count(*) from enquiries), 5::bigint);
select t_fails('wrong secret', $$select capture_enquiry('one','nope','{"mobile":"9984429770"}')$$);
select t_fails('unknown endpoint', $$select capture_enquiry('zzz','h1','{"mobile":"9984429770"}')$$);
reset role;
-- an unassigned lead on Project One (team A project) and one on Project Two
insert into people(phone_e164,full_name) values ('+919000000001','Unassigned P1'),('+919000000002','Other team');
insert into leads(person_id,project_id,stage_id) select (select id from people where full_name='Unassigned P1'),'bbbbbbbb-0000-0000-0000-000000000001',(select id from stages where is_default);
insert into leads(person_id,project_id,stage_id,assigned_to) select (select id from people where full_name='Other team'),'bbbbbbbb-0000-0000-0000-000000000002',(select id from stages where is_default),'11111111-0000-0000-0000-000000000005';
select t_eq('total leads', (select count(*) from leads), 5::bigint);

-- row level security by role
set role authenticated;
select as_user('11111111-0000-0000-0000-000000000003');
select t_eq('agent A1 sees only own leads', (select count(*) from leads), 2::bigint);
select t_eq('agent sees own people only', (select count(*) from people), 2::bigint);
select t_eq('agent cannot read audit', (select count(*) from audit_log), 0::bigint);
select t_eq('agent cannot read endpoints', (select count(*) from capture_endpoints), 0::bigint);
select t_fails('agent cannot reassign', $$update leads set assigned_to='11111111-0000-0000-0000-000000000004' where assigned_to='11111111-0000-0000-0000-000000000003'$$);
select t_fails('lost needs a reason', $$update leads set stage_id=(select id from stages where name='Lost') where assigned_to='11111111-0000-0000-0000-000000000003'$$);
select t_fails('agent cannot create lead for someone else', $$insert into leads(person_id,stage_id,assigned_to) select (select id from people limit 1),(select id from stages where is_default),'11111111-0000-0000-0000-000000000004'$$);
update leads set stage_id=(select id from stages where name='Lost'), lost_reason_id=(select id from lost_reasons where name='Not interested')
 where id=(select id from leads order by created_at limit 1);
select t_eq('lost stamped', (select count(*) from leads where lost_at is not null), 1::bigint);
select t_eq('stage history written', (select count(*) from lead_stage_history where to_stage_id=(select id from stages where name='Lost')), 1::bigint);
insert into activities(lead_id,type,assigned_to,completed_at) select id,'call','11111111-0000-0000-0000-000000000003',now() from leads order by created_at limit 1 offset 0;
select t_eq('first contact stamped', (select count(*) from leads where first_contacted_at is not null), 1::bigint);

select as_user('11111111-0000-0000-0000-000000000002');
select t_eq('manager A sees team leads plus unassigned team-project lead', (select count(*) from leads), 4::bigint);
update leads set assigned_to='11111111-0000-0000-0000-000000000004' where person_id=(select id from people where full_name='Unassigned P1');
select t_eq('manager can assign', (select count(*) from leads where assigned_to='11111111-0000-0000-0000-000000000004'), 2::bigint);
select t_eq('manager sees team profiles only', (select count(*) from profiles), 3::bigint);

select as_user('11111111-0000-0000-0000-000000000007');
select t_eq('manager B sees only team B lead', (select count(*) from leads), 1::bigint);

select as_user('11111111-0000-0000-0000-000000000006');
select t_eq('marketing sees no leads', (select count(*) from leads), 0::bigint);
select t_eq('marketing sees no people', (select count(*) from people), 0::bigint);
select t_eq('marketing sees no enquiries', (select count(*) from enquiries), 0::bigint);
select t_eq('marketing sees funnel aggregates', (select sum(leads) from marketing_funnel)::bigint, 5::bigint);

select as_user('11111111-0000-0000-0000-000000000001');
select t_eq('admin sees all leads', (select count(*) from leads), 5::bigint);
select t_eq('admin reads audit', (select count(*) > 0 from audit_log), true);
select t_eq('audit hides secret hash', (select count(*) from audit_log where new_data ? 'secret_hash'), 0::bigint);

select t_fails('user cannot call round robin directly', $$select pick_assignee('aaaaaaaa-0000-0000-0000-000000000001')$$);
select t_fails('user cannot call capture directly', $$select capture_enquiry('one','h1','{"mobile":"9984429770"}')$$);
select as_user(null);
select t_eq('signed-out sees no leads', (select count(*) from leads), 0::bigint);
reset role;
set role anon;
select t_fails('anon cannot read staff directory', $$select * from staff_directory$$);
select t_eq('anon sees zero leads', (select count(*) from leads), 0::bigint);
select t_eq('anon sees zero people', (select count(*) from people), 0::bigint);
select t_fails('anon cannot capture', $$select capture_enquiry('one','h1','{"mobile":"9984429770"}')$$);
reset role;
select t_eq('directory empty for user without profile', (select count(*) from (select set_config('request.jwt.claim.sub','99999999-0000-0000-0000-000000000009',false)) x, lateral (select 1 from staff_directory) d), 0::bigint);
\echo ALL TESTS PASSED
