\set ON_ERROR_STOP on
-- 0003 workflows: manual leads, rotation, reminders, tasks, notes, call logging, attendance, import, views.
-- Relies on fixtures from tests/behaviour.sql (Team A: Manager A, Agent A1, Agent A2; Team B: Agent B1, Manager B).
reset role;
update app_settings set value = value || '{"work_start": "00:00", "work_end": "23:59"}' where key = 'rotation';
create temp table w as select
  'bbbbbbbb-0000-0000-0000-000000000001'::uuid as p1,
  '11111111-0000-0000-0000-000000000002'::uuid as mgra,
  '11111111-0000-0000-0000-000000000003'::uuid as a1,
  '11111111-0000-0000-0000-000000000004'::uuid as a2,
  '11111111-0000-0000-0000-000000000005'::uuid as b1,
  '11111111-0000-0000-0000-000000000007'::uuid as mgrb;
create temp table got (k text primary key, v uuid);
grant select, insert, update on w, got to authenticated;
set role authenticated;

-- ---------------------------------------------------------------- manual lead entry
select as_user((select a1 from w));
insert into got select 'walkin', (create_lead(jsonb_build_object('phone','7700000001','full_name','Walk In','project_id',(select p1 from w),'source_id',(select id from sources where name='Walk-in'))) ->> 'lead_id')::uuid;
select t_eq('agent adds a walk-in, owns it', (select assigned_to from leads where id=(select v from got where k='walkin')), (select a1 from w));
select t_eq('assignment logged as create', (select reason from lead_assignments where lead_id=(select v from got where k='walkin')), 'create');
select t_eq('no self-notification', (select count(*) from notifications where lead_id=(select v from got where k='walkin')), 0::bigint);
select t_fails('invalid phone rejected', $$select create_lead('{"phone":"12345"}')$$);

select as_user((select a2 from w));
select t_eq('duplicate becomes re-enquiry', (create_lead(jsonb_build_object('phone','+91 77000 00001','project_id',(select p1 from w)))) ->> 'status', 'exists');
reset role;
select t_eq('owner told about re-enquiry', (select count(*) from notifications where user_id=(select a1 from w) and kind='reenquiry' and lead_id=(select v from got where k='walkin')), 1::bigint);
select t_eq('re-enquiry counted', (select reenquiry_count from leads where id=(select v from got where k='walkin')), 1);
set role authenticated;

select as_user('11111111-0000-0000-0000-000000000006');
select t_fails('marketing cannot add leads', $$select create_lead('{"phone":"7700000009"}')$$);

select as_user((select mgra from w));
insert into got select 'rr', (create_lead(jsonb_build_object('phone','7700000002','full_name','Round Robin','project_id',(select p1 from w),'round_robin',true)) ->> 'lead_id')::uuid;
reset role;
select t_eq('manager lead goes round robin to an agent', (select role::text from profiles where id=(select assigned_to from leads where id=(select v from got where k='rr'))), 'agent');
select t_eq('assignee notified', (select count(*) from notifications n join leads l on l.id=n.lead_id where l.id=(select v from got where k='rr') and n.user_id=l.assigned_to and n.kind='lead_assigned'), 1::bigint);

-- ---------------------------------------------------------------- untouched rotation (runs as the scheduler)
insert into got select 'rr_owner', assigned_to from leads where id=(select v from got where k='rr');
update leads set assigned_at = now() - interval '40 minutes' where id=(select v from got where k='rr');
select t_eq('rotation moves one untouched lead', rotate_untouched(), 1);
select t_eq('moved to someone else', (select assigned_to <> (select v from got where k='rr_owner') from leads where id=(select v from got where k='rr')), true);
select t_eq('rotation counted', (select rotation_count from leads where id=(select v from got where k='rr')), 1);
select t_eq('rotation logged', (select count(*) from lead_assignments where lead_id=(select v from got where k='rr') and reason='rotation'), 1::bigint);
select t_eq('previous owner told', (select count(*) from notifications where user_id=(select v from got where k='rr_owner') and kind='lead_rotated'), 1::bigint);
select t_eq('fresh assignment not rotated again', rotate_untouched(), 0);
-- a touched lead stays put
update leads set assigned_at = now() - interval '40 minutes' where id=(select v from got where k='walkin');
insert into lead_notes(lead_id, body, created_by, created_at) values ((select v from got where k='walkin'), 'met at office', (select a1 from w), now());
select t_eq('lead with a note by its owner is not rotated', rotate_untouched(), 0);
update app_settings set value = value || '{"enabled": false}' where key='rotation';
update leads set assigned_at = now() - interval '2 hours' where id=(select v from got where k='rr');
select t_eq('rotation can be switched off', rotate_untouched(), 0);
update app_settings set value = value || '{"enabled": true}' where key='rotation';

-- ---------------------------------------------------------------- reminders
update leads set next_followup_at = now() + interval '10 minutes' where id=(select v from got where k='walkin');
select t_eq('follow-up reminder queued', queue_reminders() >= 1, true);
select t_eq('reminder notification exists', (select count(*) from notifications where lead_id=(select v from got where k='walkin') and kind='followup_due'), 1::bigint);
select t_eq('no duplicate reminder', (select count(*) from notifications n where kind='followup_due' and lead_id=(select v from got where k='walkin')) + queue_reminders() * 0, 1::bigint);
select queue_reminders();
select t_eq('still one reminder after rerun', (select count(*) from notifications where lead_id=(select v from got where k='walkin') and kind='followup_due'), 1::bigint);
update leads set next_followup_at = now() + interval '12 minutes' where id=(select v from got where k='walkin');
select queue_reminders();
select t_eq('moving the follow-up re-arms the reminder', (select count(*) from notifications where lead_id=(select v from got where k='walkin') and kind='followup_due'), 2::bigint);
set role authenticated;

-- ---------------------------------------------------------------- tasks and notes
select as_user((select a1 from w));
select t_rows('agent creates own task', $$insert into tasks(lead_id,title,assigned_to,due_at,created_by) select v,'Send brochure',auth.uid(),now()+interval '20 minutes',auth.uid() from got where k='walkin'$$, 1);
select t_fails('agent cannot assign a task to a colleague', format('insert into tasks(title,assigned_to,created_by) values (%L,%L,%L)', 'x', (select a2 from w), (select a1 from w)));
select as_user((select mgra from w));
select t_rows('manager assigns task to agent', format('insert into tasks(title,assigned_to,created_by) values (%L,%L,auth.uid())', 'Call the builder', (select a1 from w)), 1);
reset role;
select t_eq('agent notified of task', (select count(*) from notifications where user_id=(select a1 from w) and kind='task_assigned'), 1::bigint);
select t_eq('task reminder queued', queue_reminders() >= 1, true);
set role authenticated;
select as_user((select a1 from w));
select t_rows('agent completes task', $$update tasks set status='done' where title='Send brochure'$$, 1);
select t_eq('completion time stamped', (select completed_at is not null from tasks where title='Send brochure'), true);
select t_rows('agent adds a note', $$insert into lead_notes(lead_id, body, created_by) select v, 'prefers 3 BHK', auth.uid() from got where k='walkin'$$, 1);
select as_user((select b1 from w));
select t_eq('other team cannot see the task', (select count(*) from tasks where title='Send brochure'), 0::bigint);
select t_fails('other team cannot add notes', format('insert into lead_notes(lead_id, body, created_by) values (%L, %L, %L)', (select v from got where k='walkin'), 'x', (select b1 from w)));

-- ---------------------------------------------------------------- call logging
select as_user((select a1 from w));
select t_eq('device call matched to lead', (log_call(jsonb_build_object('phone','7700000001','direction','outgoing','duration_seconds',65,'provider','android','device_call_id','dev-1')) ->> 'lead_id')::uuid, (select v from got where k='walkin'));
select t_eq('same device call ignored', log_call('{"phone":"7700000001","direction":"outgoing","duration_seconds":65,"provider":"android","device_call_id":"dev-1"}') ->> 'status', 'duplicate');
select t_eq('unknown number logged unmatched', log_call('{"phone":"7712345678","direction":"incoming","provider":"android","device_call_id":"dev-2"}') ->> 'matched', 'false');
select t_eq('missed incoming detected', (select status::text from calls where provider_call_id='dev-2'), 'missed');
select t_eq('batch sync counts', log_calls('[{"phone":"7700000001","duration_seconds":0,"provider":"android","device_call_id":"dev-3"},{"phone":"7700000001","duration_seconds":30,"provider":"android","device_call_id":"dev-1"}]'::jsonb) ->> 'logged', '1');
select t_eq('connected call stamps first contact', (select first_contacted_at is not null from leads where id=(select v from got where k='walkin')), true);
select t_eq('manual web log with outcome', log_call(jsonb_build_object('lead_id',(select v from got where k='walkin'),'duration_seconds',120,'outcome','Connected, interested','notes','wants site visit')) ->> 'status', 'logged');
select as_user((select b1 from w));
select t_eq('other team cannot see those calls', (select count(*) from calls where lead_id=(select v from got where k='walkin')), 0::bigint);
select as_user('11111111-0000-0000-0000-000000000006');
select t_fails('marketing cannot log calls', $$select log_call('{"phone":"7700000001"}')$$);

-- ---------------------------------------------------------------- attendance
select as_user((select a1 from w));
select t_rows('agent checks in', $$insert into attendance(kind, lat, lng, address) values ('in', 26.78, 80.99, 'Golf City')$$, 1);
select t_fails('agent cannot check in for someone else', format('insert into attendance(user_id, kind) values (%L, %L)', (select a2 from w), 'in'));
select as_user((select mgra from w));
select t_eq('manager sees team attendance', (select count(*) from attendance where user_id=(select a1 from w)), 1::bigint);
select as_user((select mgrb from w));
select t_eq('other manager does not', (select count(*) from attendance where user_id=(select a1 from w)), 0::bigint);

-- ---------------------------------------------------------------- import
select as_user((select a1 from w));
select t_fails('agents cannot import', $$select import_leads('[{"phone":"7700000100"}]')$$);
select as_user((select mgra from w));
insert into got select 'imp', (import_leads(
  '[{"phone":"7700000100","name":"Imported One","project":"Project One","source":"Facebook Lead Ads","owner_email":"a2@x","stage":"Follow-up"},
    {"phone":"12","name":"Bad"},
    {"phone":"7700000001","project":"Project One","name":"Dup"},
    {"phone":"7700000101","project":"No Such Project"}]'::jsonb,
  '{"file_name":"test.csv"}'::jsonb) ->> 'batch_id')::uuid;
reset role;
select t_eq('import inserted', (select inserted from import_batches where id=(select v from got where k='imp')), 1);
select t_eq('import skipped duplicate', (select skipped from import_batches where id=(select v from got where k='imp')), 1);
select t_eq('import failed rows recorded', (select failed from import_batches where id=(select v from got where k='imp')), 2);
select t_eq('import owner by email', (select p.full_name from leads l join people pe on pe.id=l.person_id join profiles p on p.id=l.assigned_to where pe.phone_e164='+917700000100'), 'Agent A2');
select t_eq('import stage applied', (select s.name from leads l join people pe on pe.id=l.person_id join stages s on s.id=l.stage_id where pe.phone_e164='+917700000100'), 'Follow-up');
select t_eq('imported lead counts as contacted', (select first_contacted_at is not null from leads l join people pe on pe.id=l.person_id where pe.phone_e164='+917700000100'), true);
select t_eq('import assignment reason', (select a.reason from lead_assignments a join leads l on l.id=a.lead_id join people pe on pe.id=l.person_id where pe.phone_e164='+917700000100'), 'import');
set role authenticated;

-- ---------------------------------------------------------------- notifications and views
select as_user((select a1 from w));
select t_eq('agent marks notifications read', mark_notifications_read() > 0, true);
select t_eq('none unread after', (select count(*) from notifications where read_at is null), 0::bigint);
select t_eq('agent sees only own notifications', (select count(*) from notifications where user_id <> auth.uid()), 0::bigint);
select t_rows('agent saves a private view', $$insert into saved_views(name, params) values ('My hot', '{"temp":"hot"}')$$, 1);
select t_rows('agent saves a public view', $$insert into saved_views(name, params, is_public) values ('Team overdue', '{"view":"overdue"}', true)$$, 1);
select as_user((select a2 from w));
select t_eq('colleague sees only the public view', (select string_agg(name, ',') from saved_views), 'Team overdue');
select t_rows('colleague cannot delete it', $$delete from saved_views where name='Team overdue'$$, 0);

reset role;
\echo ALL WORKFLOW TESTS PASSED
