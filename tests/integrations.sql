\set ON_ERROR_STOP on
-- 0005 integrations: routing, ingest with ad attribution, dedupe, unmapped and invalid leads, alerts,
-- notification delivery claims, the Google Sheets queue and integration secrets.
-- Fixtures from tests/behaviour.sql: Team A (Manager A, Agent A1, Agent A2) owns Project One;
-- Team B (Manager B, Agent B1) owns Project Two; Admin; Marketing.
reset role;
create temp table ix as select
  '11111111-0000-0000-0000-000000000001'::uuid as admin,
  '11111111-0000-0000-0000-000000000002'::uuid as mgra,
  '11111111-0000-0000-0000-000000000003'::uuid as a1,
  '11111111-0000-0000-0000-000000000006'::uuid as mkt,
  'aaaaaaaa-0000-0000-0000-000000000001'::uuid as team_a,
  'bbbbbbbb-0000-0000-0000-000000000001'::uuid as p1;
grant select on ix to authenticated, service_role;
update auth.users set email = 'a1@relive.test' where id = (select a1 from ix);
update auth.users set email = 'mgra@relive.test' where id = (select mgra from ix);
update auth.users set email = 'admin@relive.test' where id = (select admin from ix);
update notifications set pushed_at = now(), emailed_at = now();  -- earlier test files' alerts are not this file's concern

insert into vendors(name) values ('Adwise Agency');
insert into capture_endpoints(slug, name, provider, source_id, project_id, team_id, vendor_id, secret_hash, match_page_id, match_form_ids)
values ('meta-p1-form', 'Project One FB form', 'meta', (select id from sources where name = 'Facebook Lead Ads'),
        (select p1 from ix), (select team_a from ix), (select id from vendors where name = 'Adwise Agency'), 'x', '555', array['F100', 'F101']),
       ('meta-page', 'Page 555 other forms', 'meta', null, null, null, null, 'x', '555', '{}'),
       ('meta-default', 'Facebook catch-all', 'meta', null, null, null, null, 'x', null, '{}');
update capture_endpoints set is_default = true where slug = 'meta-default';
insert into capture_endpoints(slug, name, provider, project_id, team_id, secret_hash, match_form_ids)
values ('gads-p1', 'Project One Google lead form', 'google_ads', (select p1 from ix), (select team_a from ix), 'x', array['G1']);

-- ---------------------------------------------------------------- routing
select t_eq('form id beats page', route_endpoint('meta', '555', 'F101'), (select id from capture_endpoints where slug = 'meta-p1-form'));
select t_eq('page match for an unmapped form on that page', route_endpoint('meta', '555', 'F999'), (select id from capture_endpoints where slug = 'meta-page'));
select t_eq('catch-all for an unknown page', route_endpoint('meta', '777', 'F999'), (select id from capture_endpoints where slug = 'meta-default'));
select t_eq('no catch-all for google ads means null', route_endpoint('google_ads', null, 'G999'), null::uuid);

-- ---------------------------------------------------------------- ingest
create temp table r(k text primary key, v jsonb);
grant all on r to service_role;
set role service_role;
select set_config('request.jwt.claim.role', 'service_role', false);
insert into r select 'fb1', ingest_lead(route_endpoint('meta', '555', 'F100'), jsonb_build_object(
  'provider', 'meta', 'external_id', 'LG-1', 'phone', '+91 77000 00901', 'name', 'Fb Lead One', 'email', 'one@example.com',
  'city', 'Lucknow', 'answers', jsonb_build_object('budget', '50 L to 1 Cr', 'when_are_you_planning_to_buy', 'Within 3 months'),
  'campaign_id', 'C1', 'campaign_name', 'Lucknow Central Oct', 'adset_id', 'AS1', 'adset_name', 'Gomti Nagar 25-45',
  'ad_id', 'AD1', 'ad_name', 'Reel 3', 'form_id', 'F100', 'form_name', 'Studio form', 'platform', 'ig'));
reset role;
select t_eq('meta lead processed', (select v ->> 'status' from r where k = 'fb1'), 'processed');
select t_eq('campaign kept on the lead', (select campaign_name from leads where id = (select (v ->> 'lead_id')::uuid from r where k = 'fb1')), 'Lucknow Central Oct');
select t_eq('ad set kept', (select adset_name from leads where id = (select (v ->> 'lead_id')::uuid from r where k = 'fb1')), 'Gomti Nagar 25-45');
select t_eq('ad kept', (select ad_name from leads where id = (select (v ->> 'lead_id')::uuid from r where k = 'fb1')), 'Reel 3');
select t_eq('platform kept', (select platform from leads where id = (select (v ->> 'lead_id')::uuid from r where k = 'fb1')), 'ig');
select t_eq('vendor from the endpoint', (select v2.name from leads l join vendors v2 on v2.id = l.vendor_id where l.id = (select (v ->> 'lead_id')::uuid from r where k = 'fb1')), 'Adwise Agency');
select t_eq('project from the endpoint', (select project_id from leads where id = (select (v ->> 'lead_id')::uuid from r where k = 'fb1')), (select p1 from ix));
select t_eq('given to a team A agent', (select team_id from profiles where id = (select assigned_to from leads where id = (select (v ->> 'lead_id')::uuid from r where k = 'fb1'))), (select team_a from ix));
select t_eq('form answers readable on the lead', (select description from leads where id = (select (v ->> 'lead_id')::uuid from r where k = 'fb1')), 'Budget: 50 L to 1 Cr · When Are You Planning To Buy: Within 3 months');
select t_eq('enquiry keeps the external id', (select count(*) from enquiries where provider = 'meta' and external_id = 'LG-1'), 1::bigint);
select t_eq('assignee alerted', (select count(*) from notifications where lead_id = (select (v ->> 'lead_id')::uuid from r where k = 'fb1') and kind = 'lead_assigned'), 1::bigint);
select t_eq('event logged', (select status from integration_events where external_id = 'LG-1' order by id desc limit 1), 'processed');

set role service_role;
insert into r select 'fb1again', ingest_lead(route_endpoint('meta', '555', 'F100'), jsonb_build_object('provider', 'meta', 'external_id', 'LG-1', 'phone', '7700000901'));
reset role;
select t_eq('same Facebook lead twice is a duplicate', (select v ->> 'status' from r where k = 'fb1again'), 'duplicate');
select t_eq('duplicate points at the first lead', (select v ->> 'lead_id' from r where k = 'fb1again'), (select v ->> 'lead_id' from r where k = 'fb1'));
select t_eq('no second enquiry', (select count(*) from enquiries where external_id = 'LG-1'), 1::bigint);

-- the same person through a different form of the same project is a re-enquiry, and the owner hears about it
set role service_role;
insert into r select 'fb2', ingest_lead(route_endpoint('meta', '555', 'F101'), jsonb_build_object('provider', 'meta', 'external_id', 'LG-2', 'phone', '7700000901', 'form_name', 'Price form'));
reset role;
select t_eq('re-enquiry across forms', (select v ->> 'reenquiry' from r where k = 'fb2'), 'true');
select t_eq('owner told', (select count(*) from notifications where lead_id = (select (v ->> 'lead_id')::uuid from r where k = 'fb1') and kind = 'reenquiry'), 1::bigint);

-- a form nobody mapped, with no catch-all: saved, unassigned, admins and nobody else told
set role service_role;
insert into r select 'gx', ingest_lead(route_endpoint('google_ads', null, 'G999'), jsonb_build_object('provider', 'google_ads', 'external_id', 'GL-9', 'phone', '7700000902', 'name', 'Unmapped G'));
reset role;
select t_eq('unmapped lead still saved', (select v ->> 'status' from r where k = 'gx'), 'processed');
select t_eq('unmapped lead is unassigned', (select assigned_to from leads where id = (select (v ->> 'lead_id')::uuid from r where k = 'gx')), null::uuid);
select t_eq('admin told about it', (select count(*) from notifications where lead_id = (select (v ->> 'lead_id')::uuid from r where k = 'gx') and kind = 'lead_unassigned' and user_id = (select admin from ix)), 1::bigint);
select t_eq('logged as unmapped', (select status from integration_events where external_id = 'GL-9'), 'unmapped');

-- unusable phone: kept as an enquiry, admins told
set role service_role;
insert into r select 'bad', ingest_lead(route_endpoint('google_ads', null, 'G1'), jsonb_build_object('provider', 'google_ads', 'external_id', 'GL-10', 'phone', '12345', 'name', 'Bad Number', 'form_name', 'G form'));
reset role;
select t_eq('invalid phone kept', (select v ->> 'status' from r where k = 'bad'), 'invalid_phone');
select t_eq('admin told about invalid phone', (select count(*) from notifications where kind = 'lead_invalid' and user_id = (select admin from ix) and body like 'Bad Number%'), 1::bigint);

-- "tell me about every new lead" for a team leader
insert into notification_settings(user_id, all_new_leads) values ((select mgra from ix), true);
set role service_role;
insert into r select 'g1', ingest_lead(route_endpoint('google_ads', null, 'G1'), jsonb_build_object('provider', 'google_ads', 'external_id', 'GL-11', 'phone', '7700000903', 'name', 'Google One', 'campaign_id', '123'));
reset role;
select t_eq('team leader told about a new team lead', (select count(*) from notifications where lead_id = (select (v ->> 'lead_id')::uuid from r where k = 'g1') and kind = 'lead_new' and user_id = (select mgra from ix)), 1::bigint);

-- slug + secret webhooks keep extra form fields as answers
update capture_endpoints set secret_hash = 'h2' where slug = 'gads-p1';
insert into capture_endpoints(slug, name, provider, project_id, team_id, secret_hash)
values ('gforms-p1', 'Site visit Google Form', 'google_forms', (select p1 from ix), (select team_a from ix), 'gf');
insert into r select 'gf', capture_enquiry('gforms-p1', 'gf', '{"contact":"Form Person","mobile":"7700000904","configuration":"2 BHK","budget":"1 Cr","utm_campaign":"Diwali"}');
select t_eq('google form lead processed', (select v ->> 'status' from r where k = 'gf'), 'processed');
select t_eq('extra fields become answers', (select description from leads where id = (select (v ->> 'lead_id')::uuid from r where k = 'gf')), 'Budget: 1 Cr · Configuration: 2 BHK');
select t_eq('utm campaign kept', (select campaign_name from leads where id = (select (v ->> 'lead_id')::uuid from r where k = 'gf')), 'Diwali');
select t_eq('provider from endpoint', (select provider from leads where id = (select (v ->> 'lead_id')::uuid from r where k = 'gf')), 'google_forms');

-- only the server can ingest
set role authenticated;
select as_user((select a1 from ix));
select set_config('request.jwt.claim.role', 'authenticated', false);
select t_fails('staff cannot call ingest_lead', $$select ingest_lead(null, '{"phone":"7700000999"}')$$);
select t_eq('agent cannot read the integration log', (select count(*) from integration_events), 0::bigint);
select t_fails('agent cannot add vendors', $$insert into vendors(name) values ('Sneaky')$$);
reset role;

-- ---------------------------------------------------------------- notification delivery
insert into notification_settings(user_id, email_enabled) values ((select a1 from ix), false)
  on conflict (user_id) do update set email_enabled = false;
set role service_role;
select set_config('request.jwt.claim.role', 'service_role', false);
insert into r select 'claim1', notification_claim(500);
insert into r select 'claim2', notification_claim(500);
reset role;
select t_eq('claim returns pending alerts', (select jsonb_array_length(v) > 0 from r where k = 'claim1'), true);
select t_eq('second claim gets nothing (no double send)', (select jsonb_array_length(v) from r where k = 'claim2'), 0);
select t_eq('admin alert carries an email address', (select count(*) from r, jsonb_array_elements(v) x where k = 'claim1' and x ->> 'user_id' = (select admin::text from ix) and x ->> 'email' = 'admin@relive.test') > 0, true);
select t_eq('email off means no email for that person', (select count(*) from r, jsonb_array_elements(v) x where k = 'claim1' and x ->> 'user_id' = (select a1::text from ix) and x ->> 'email' is not null), 0::bigint);
select t_eq('kinds not chosen are not emailed', (select count(*) from r, jsonb_array_elements(v) x where k = 'claim1' and x ->> 'kind' = 'lead_new' and x ->> 'email' is not null), 0::bigint);
select t_eq('everything claimed is marked', (select count(*) from notifications where pushed_at is null or emailed_at is null), 0::bigint);

-- ---------------------------------------------------------------- Google Sheets queue
delete from sheet_queue;
update leads set priority = 'High' where id = (select (v ->> 'lead_id')::uuid from r where k = 'fb1');
select t_eq('no sheets configured, nothing queued', (select count(*) from sheet_queue), 0::bigint);
insert into sheet_targets(name, spreadsheet_id, scope) values ('Master', 'SHEET-MASTER', 'all');
insert into sheet_targets(name, spreadsheet_id, scope, scope_id) values ('Adwise', 'SHEET-ADWISE', 'vendor', (select id from vendors where name = 'Adwise Agency'));
update leads set priority = 'Low' where id = (select (v ->> 'lead_id')::uuid from r where k = 'fb1');
insert into lead_notes(lead_id, body, created_by) values ((select (v ->> 'lead_id')::uuid from r where k = 'g1'), 'Asked for a callback after 6 pm', (select a1 from ix));
select t_eq('stage or remark changes queue the lead', (select count(*) from sheet_queue), 2::bigint);
update leads set temperature = 'hot' where id = (select (v ->> 'lead_id')::uuid from r where k = 'fb1');
select t_eq('a lead is queued once however often it changes', (select count(*) from sheet_queue), 2::bigint);
set role service_role;
create temp table claimed as select * from sheet_claim(100);
reset role;
select t_eq('claim takes the queue', (select count(*) from claimed), 2::bigint);
select t_eq('queue emptied', (select count(*) from sheet_queue), 0::bigint);
select t_eq('row carries the ad set', (select adset_name from claimed where name = 'Fb Lead One'), 'Gomti Nagar 25-45');
select t_eq('row carries the vendor id for the vendor sheet', (select vendor_id from claimed where name = 'Fb Lead One'), (select id from vendors where name = 'Adwise Agency'));
select t_eq('row carries the latest remark', (select last_remark from claimed where name = 'Google One'), 'Asked for a callback after 6 pm');
select t_eq('phone in international format', (select phone from claimed where name = 'Fb Lead One'), '+917700000901');
set role service_role;
select sheet_requeue(array[(select lead_id from claimed where name = 'Google One')]);
reset role;
select t_eq('failed rows go back on the queue', (select attempts from sheet_queue), 1);
set role authenticated;
select as_user((select admin from ix));
select set_config('request.jwt.claim.role', 'authenticated', false);
select t_eq('admin resync for one vendor queues only its leads', sheet_resync((select id from sheet_targets where name = 'Adwise')) >= 1, true);
select as_user((select a1 from ix));
select t_fails('agent cannot resync', $$select sheet_resync()$$);
select t_fails('agent cannot read sheet rows', $$select * from lead_sheet_rows limit 1$$);
select t_eq('agent sees no sheet targets', (select count(*) from sheet_targets), 0::bigint);

-- ---------------------------------------------------------------- secrets
select t_fails('agent cannot set a secret', $$select integration_secret_set('meta_page_token:555', 'abc')$$);
select as_user((select admin from ix));
select integration_secret_set('meta_page_token:555', 'EAAB-token');
select t_eq('admin sees that it is set', (select count(*) from integration_secret_status() where key = 'meta_page_token:555'), 1::bigint);
select t_fails('admin cannot read it back', $$select integration_secret_get('meta_page_token:555')$$);
reset role;
set role service_role;
select t_eq('server can read it', integration_secret_get('meta_page_token:555'), 'EAAB-token');
reset role;
select set_config('request.jwt.claim.role', '', false);
select as_user(null);
do $$ begin raise notice 'ALL INTEGRATION TESTS PASSED'; end $$;
