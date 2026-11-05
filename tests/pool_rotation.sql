\set ON_ERROR_STOP on
-- 0025: open pool (first call wins), fallback owner, idle rotation, visits, history, reports, ads. Uses fixtures from behaviour.sql.
reset role;
select as_user(null);
update app_settings set value = jsonb_build_object('user_id', '11111111-0000-0000-0000-000000000001') where key = 'fallback_owner';

-- a rule whose only member cannot take leads: the lead must bounce to the fallback owner, not sit unowned
insert into routing_rules(id, name, active, form_ids) values ('cccccccc-0000-0000-0000-000000000001', 'Nobody free', true, '{F-EMPTY}');
insert into routing_members(rule_id, user_id, position, active) values ('cccccccc-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000005', 1, false);
create temp table pr(k text, r jsonb);
insert into pr select 'bounce', ingest_lead(null, '{"provider":"meta","external_id":"P-1","phone":"7711000001","name":"Bounce","form_id":"F-EMPTY"}');
select t_eq('bounced lead goes to fallback owner', (select (r ->> 'assigned_to') from pr where k = 'bounce'), '11111111-0000-0000-0000-000000000001');
select t_eq('bounce flagged', (select (r ->> 'fallback') from pr where k = 'bounce'), 'true');
select t_eq('assignment reason fallback', (select reason from lead_assignments where lead_id = (select (r ->> 'lead_id')::uuid from pr where k = 'bounce')), 'fallback');
select t_eq('fallback owner alerted once', (select count(*) from notifications where kind = 'lead_bounced' and lead_id = (select (r ->> 'lead_id')::uuid from pr where k = 'bounce')), 1::bigint);

-- open pool: everyone in the rule is alerted, the first to log a call keeps it
insert into routing_rules(id, name, active, form_ids, claim_mode) values ('cccccccc-0000-0000-0000-000000000002', 'Open pool', true, '{F-POOL}', true);
insert into routing_members(rule_id, user_id, position, active) values
  ('cccccccc-0000-0000-0000-000000000002', '11111111-0000-0000-0000-000000000003', 1, true),
  ('cccccccc-0000-0000-0000-000000000002', '11111111-0000-0000-0000-000000000004', 2, true);
insert into pr select 'pool', ingest_lead(null, '{"provider":"meta","external_id":"P-2","phone":"7711000002","name":"Pooly","form_id":"F-POOL"}');
create temp table pctx as select (r ->> 'lead_id')::uuid lead from pr where k = 'pool';
grant select on pctx to authenticated;
grant select on pr to authenticated;
select t_eq('pool lead has no owner', (select assigned_to from leads where id = (select lead from pctx)), null::uuid);
select t_eq('pool lead marked', (select pool_rule_id from leads where id = (select lead from pctx)), 'cccccccc-0000-0000-0000-000000000002'::uuid);
select t_eq('both members alerted', (select count(*) from notifications where kind = 'lead_pool' and lead_id = (select lead from pctx)), 2::bigint);
select t_eq('no unassigned alert for a pool lead', (select count(*) from notifications where kind = 'lead_unassigned' and lead_id = (select lead from pctx)), 0::bigint);
set role authenticated;
select as_user('11111111-0000-0000-0000-000000000003');
select t_eq('member A1 sees the pool lead', (select count(*) from leads where id = (select lead from pctx)), 1::bigint);
select as_user('11111111-0000-0000-0000-000000000005');
select t_eq('non-member B1 does not', (select count(*) from leads where id = (select lead from pctx)), 0::bigint);
select t_eq('non-member call does not claim', (log_call('{"phone":"7711000002","direction":"outgoing","duration_seconds":30,"provider":"t","device_call_id":"c0"}') ->> 'claimed'), 'false');
select as_user('11111111-0000-0000-0000-000000000003');
select t_rows('member cannot claim by plain update', format('update leads set assigned_to = %L where id = %L', '11111111-0000-0000-0000-000000000003', (select lead from pctx)), 0);
select as_user('11111111-0000-0000-0000-000000000004');
select t_eq('A2 calls first and claims', (log_call('{"phone":"7711000002","direction":"outgoing","duration_seconds":40,"provider":"t","device_call_id":"c1"}') ->> 'claimed'), 'true');
select as_user('11111111-0000-0000-0000-000000000003');
select t_eq('A1 loses sight after claim', (select count(*) from leads where id = (select lead from pctx)), 0::bigint);
select t_eq('A1 later call does not claim', coalesce(log_call('{"phone":"7711000002","direction":"outgoing","provider":"t","device_call_id":"c2"}') ->> 'claimed', 'false'), 'false');
reset role;
select as_user(null);
select t_eq('owner is A2', (select assigned_to from leads where id = (select lead from pctx)), '11111111-0000-0000-0000-000000000004'::uuid);
select t_eq('pool cleared', (select pool_rule_id from leads where id = (select lead from pctx)), null::uuid);
select t_eq('claim logged', (select reason from lead_assignments where lead_id = (select lead from pctx) order by at desc limit 1), 'claim');
select t_eq('A1 told it was taken', (select count(*) from notifications where kind = 'lead_claimed' and user_id = '11111111-0000-0000-0000-000000000003' and lead_id = (select lead from pctx)), 1::bigint);

-- a call logged by hand as an activity claims too
insert into pr select 'pool2', ingest_lead(null, '{"provider":"meta","external_id":"P-3","phone":"7711000003","name":"Pool Two","form_id":"F-POOL"}');
set role authenticated;
select as_user('11111111-0000-0000-0000-000000000003');
select t_rows('A1 logs a call activity', format($$insert into activities(lead_id,type,notes,assigned_to,created_by,completed_at) values (%L,'call','rang',auth.uid(),auth.uid(),now())$$, (select (r ->> 'lead_id') from pr where k = 'pool2')), 1);
reset role;
select as_user(null);
select t_eq('activity call claimed it', (select assigned_to from leads where id = (select (r ->> 'lead_id')::uuid from pr where k = 'pool2')), '11111111-0000-0000-0000-000000000003'::uuid);

-- nobody calls: after the timeout the normal round robin takes over
insert into pr select 'pool3', ingest_lead(null, '{"provider":"meta","external_id":"P-4","phone":"7711000004","name":"Pool Three","form_id":"F-POOL"}');
update leads set pooled_at = now() - interval '2 hours' where id = (select (r ->> 'lead_id')::uuid from pr where k = 'pool3');
select t_eq('expired pool lead handed out', private.expire_pool(), 1);
select t_eq('timeout reason', (select reason from lead_assignments where lead_id = (select (r ->> 'lead_id')::uuid from pr where k = 'pool3') order by at desc limit 1), 'pool_timeout');
select t_eq('timed-out lead has owner', (select assigned_to is not null and pool_rule_id is null from leads where id = (select (r ->> 'lead_id')::uuid from pr where k = 'pool3')), true);

-- idle rotation
insert into routing_rules(id, name, active, match_project_id) values ('cccccccc-0000-0000-0000-000000000003', 'Project One people', true, 'bbbbbbbb-0000-0000-0000-000000000001');
insert into routing_members(rule_id, user_id, position, active) values
  ('cccccccc-0000-0000-0000-000000000003', '11111111-0000-0000-0000-000000000003', 1, true),
  ('cccccccc-0000-0000-0000-000000000003', '11111111-0000-0000-0000-000000000004', 2, true);
insert into people(id, phone_e164, full_name) values
  ('dddddddd-0000-0000-0000-000000000001', '+917711000011', 'Ytt'), ('dddddddd-0000-0000-0000-000000000002', '+917711000012', 'Idle'),
  ('dddddddd-0000-0000-0000-000000000003', '+917711000013', 'Planned'), ('dddddddd-0000-0000-0000-000000000004', '+917711000014', 'Far plan');
insert into leads(id, person_id, project_id, stage_id, assigned_to, created_at, next_followup_at) values
  ('eeeeeeee-0000-0000-0000-000000000001', 'dddddddd-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000001', (select id from stages where name = 'Yet To Talk'), '11111111-0000-0000-0000-000000000003', now() - interval '30 days', null),
  ('eeeeeeee-0000-0000-0000-000000000002', 'dddddddd-0000-0000-0000-000000000002', 'bbbbbbbb-0000-0000-0000-000000000001', (select id from stages where name = 'Follow-up'), '11111111-0000-0000-0000-000000000003', now() - interval '30 days', null),
  ('eeeeeeee-0000-0000-0000-000000000003', 'dddddddd-0000-0000-0000-000000000003', 'bbbbbbbb-0000-0000-0000-000000000001', (select id from stages where name = 'Follow-up'), '11111111-0000-0000-0000-000000000003', now() - interval '30 days', now() + interval '3 days'),
  ('eeeeeeee-0000-0000-0000-000000000004', 'dddddddd-0000-0000-0000-000000000004', 'bbbbbbbb-0000-0000-0000-000000000001', (select id from stages where name = 'Follow-up'), '11111111-0000-0000-0000-000000000003', now() - interval '30 days', now() + interval '40 days');
update leads set assigned_at = now() - interval '20 days', stage_changed_at = now() - interval '6 days', last_activity_at = now() - interval '1 day' where id = 'eeeeeeee-0000-0000-0000-000000000001';
update leads set assigned_at = now() - interval '20 days', stage_changed_at = now() - interval '20 days', last_activity_at = now() - interval '16 days'
 where id in ('eeeeeeee-0000-0000-0000-000000000002', 'eeeeeeee-0000-0000-0000-000000000003', 'eeeeeeee-0000-0000-0000-000000000004');
create temp table idle_s as select (value || '{"idle_enabled": true}'::jsonb) s from app_settings where key = 'rotation';
select t_eq('ytt lead is a candidate', (select reason from private.idle_candidates((select s from idle_s)) where lead_id = 'eeeeeeee-0000-0000-0000-000000000001'), 'rotation_ytt');
select t_eq('16 days untouched is a candidate', (select reason from private.idle_candidates((select s from idle_s)) where lead_id = 'eeeeeeee-0000-0000-0000-000000000002'), 'rotation_idle');
select t_eq('follow-up in 3 days protects', (select count(*) from private.idle_candidates((select s from idle_s)) where lead_id = 'eeeeeeee-0000-0000-0000-000000000003'), 0::bigint);
select t_eq('follow-up in 40 days does not protect', (select count(*) from private.idle_candidates((select s from idle_s)) where lead_id = 'eeeeeeee-0000-0000-0000-000000000004'), 1::bigint);
select t_eq('idle rules off by default', private.rotate_idle((select value from app_settings where key = 'rotation')), 0);
select private.rotate_idle((select s from idle_s));
select t_eq('ytt lead moved to A2', (select assigned_to from leads where id = 'eeeeeeee-0000-0000-0000-000000000001'), '11111111-0000-0000-0000-000000000004'::uuid);
select t_eq('ytt reason logged', (select reason from lead_assignments where lead_id = 'eeeeeeee-0000-0000-0000-000000000001' order by at desc limit 1), 'rotation_ytt');
select t_eq('protected lead stays', (select assigned_to from leads where id = 'eeeeeeee-0000-0000-0000-000000000003'), '11111111-0000-0000-0000-000000000003'::uuid);
select t_eq('moved lead restarts its clock', (select count(*) from private.idle_candidates((select s from idle_s)) where lead_id = 'eeeeeeee-0000-0000-0000-000000000001'), 0::bigint);
select t_eq('rotated owner alerted', (select count(*) from notifications where kind = 'lead_rotated' and lead_id = 'eeeeeeee-0000-0000-0000-000000000002'), 1::bigint);

-- meetings and site visits
insert into site_visits(lead_id, scheduled_at, kind, status, feedback) values ('eeeeeeee-0000-0000-0000-000000000003', now() - interval '1 hour', 'meeting', 'done', 'liked the floor plan');
select t_eq('done visit stamps done_at', (select done_at is not null from site_visits where lead_id = 'eeeeeeee-0000-0000-0000-000000000003'), true);
select t_eq('done visit counts as activity', (select last_activity_at > now() - interval '5 minutes' from leads where id = 'eeeeeeee-0000-0000-0000-000000000003'), true);
insert into site_visits(lead_id, scheduled_at) values ('eeeeeeee-0000-0000-0000-000000000004', now() + interval '1 day');
update site_visits set done_at = now() where lead_id = 'eeeeeeee-0000-0000-0000-000000000004';
select t_eq('old "mark done" path sets status', (select status from site_visits where lead_id = 'eeeeeeee-0000-0000-0000-000000000004'), 'done');

-- history and views
set role authenticated;
select as_user('11111111-0000-0000-0000-000000000003');
select touch_lead_view('eeeeeeee-0000-0000-0000-000000000003');
select t_rows('owner changes temperature', $$update leads set temperature = 'hot' where id = 'eeeeeeee-0000-0000-0000-000000000003'$$, 1);
select t_eq('history shows the field change', (select new_value from lead_history('eeeeeeee-0000-0000-0000-000000000003') where field = 'temperature' limit 1), 'hot');
select t_eq('view recorded', (select views from lead_views where lead_id = 'eeeeeeee-0000-0000-0000-000000000003' and user_id = auth.uid()), 1);
select as_user('11111111-0000-0000-0000-000000000005');
select t_eq('outsider sees no history', (select count(*) from lead_history('eeeeeeee-0000-0000-0000-000000000003')), 0::bigint);
select touch_lead_view('eeeeeeee-0000-0000-0000-000000000003');
reset role;
select as_user(null);
select t_eq('outsider view not recorded', (select count(*) from lead_views where user_id = '11111111-0000-0000-0000-000000000005'), 0::bigint);

-- reports
set role authenticated;
select as_user('11111111-0000-0000-0000-000000000001');
select t_eq('team report lists agents', (select count(*) from jsonb_array_elements(team_report(now() - interval '60 days', now() + interval '1 day')) e where e ->> 'name' = 'Agent A2'), 1::bigint);
select t_eq('team report counts the claim', (select (e ->> 'claimed')::int from jsonb_array_elements(team_report(now() - interval '60 days', now() + interval '1 day')) e where e ->> 'name' = 'Agent A2'), 1);
select t_eq('funnel by source works', jsonb_typeof(funnel_report(now() - interval '60 days', now() + interval '1 day', 'source')), 'array');
select t_eq('rotation preview works', jsonb_typeof(rotation_preview()), 'object');
select as_user('11111111-0000-0000-0000-000000000003');
select t_eq('agent report shows only themselves', jsonb_array_length(team_report(now() - interval '60 days', now() + interval '1 day')), 1);
select t_fails('agent cannot preview rotation', 'select rotation_preview()');
select t_fails('agent cannot read ads report', $$select ads_report(current_date - 30, current_date)$$);

-- ad spend joined to leads
reset role;
select as_user(null);
insert into meta_ad_insights(day, ad_id, account_id, account_name, campaign_id, campaign_name, ad_name, spend, clicks, meta_leads)
values (current_date, 'AD-1', '999', 'Acct', 'CMP-1', 'Camp', 'Ad one', 1000, 50, 2);
update leads set ad_id = 'AD-1' where id = (select lead from pctx);
set role authenticated;
select as_user('11111111-0000-0000-0000-000000000006');
select t_eq('marketing reads ads report', (ads_report(current_date - 1, current_date) -> 'totals' ->> 'spend')::numeric, 1000::numeric);
select t_eq('spend allocated to the lead owner', (select (e ->> 'spend')::numeric from jsonb_array_elements(ads_report(current_date - 1, current_date) -> 'by_owner') e where e ->> 'name' = 'Agent A2'), 1000::numeric);
reset role;
select as_user(null);
select 'PASSED pool_rotation' as done;
