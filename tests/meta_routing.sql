\set ON_ERROR_STOP on
-- 0013: Facebook routing from form names, intake person, default priority, answers into fields, overseas numbers.
reset role;
insert into sources(name) values ('DFBL'), ('BTFBL'), ('HFBL'), ('FBL') on conflict (name) do nothing;
update sources set active = true where name in ('DFBL', 'BTFBL', 'HFBL', 'FBL');
insert into projects(name) values ('Migsun'), ('Rishita'), ('Rishita Serenity') on conflict (name) do nothing;
-- Page-wide entry, like one Cratio account for the whole Reliive Page: intake person Agent A1, priority High
insert into capture_endpoints(slug, name, provider, team_id, secret_hash, match_page_id, assign_to, default_priority)
values ('rt-page', 'Reliive Page, all forms', 'meta', 'aaaaaaaa-0000-0000-0000-000000000001', 'x', '4885',
        '11111111-0000-0000-0000-000000000003', 'High'),
       ('rt-form', 'One form set by hand', 'meta', 'aaaaaaaa-0000-0000-0000-000000000001', 'x', '4885', null, null);
update capture_endpoints set match_form_ids = array['F-HAND'], source_id = (select id from sources where name = 'HFBL'),
       project_id = 'bbbbbbbb-0000-0000-0000-000000000001' where slug = 'rt-form';

select t_eq('code found as a whole word', (select name from sources where id = source_from_text('SAHU CITY PEARL - BTFBL')), 'BTFBL');
select t_eq('longest code wins over FBL', (select name from sources where id = source_from_text('LPM 2.O-DFBL - SACHIN')), 'DFBL');
select t_eq('no code, no source', source_from_text('Diwali offer form'), null::uuid);
select t_eq('longest project wins', (select name from projects where id = project_from_text('RISHITA SERENITY - DFBL')), 'Rishita Serenity');
select t_eq('project in any case', (select name from projects where id = project_from_text('migsun-btfbl video')), 'Migsun');

create temp table rr(k text primary key, v jsonb);
insert into rr select 'a', ingest_lead(route_endpoint('meta', '4885', 'F-NEW'), jsonb_build_object(
  'provider', 'meta', 'external_id', 'RT-1', 'phone', '+447449973282', 'name', 'Overseas Buyer',
  'form_name', 'MIGSUN - BTFBL', 'campaign_name', 'Oct push',
  'answers', jsonb_build_object('what_is_your_budget_for_the_property', '1Cr-1.5Cr', 'preferred_location', 'Shaheed Path',
                                'which_configuration', '3 BHK', 'when_are_you_planning_to_buy', 'Within 3 months')));
select t_eq('overseas number kept with its country code', (select phone_e164 from people p join leads l on l.person_id = p.id where l.id = (select (v ->> 'lead_id')::uuid from rr where k = 'a')), '+447449973282');
select t_eq('source read from form name', (select s.name from leads l join sources s on s.id = l.source_id where l.id = (select (v ->> 'lead_id')::uuid from rr where k = 'a')), 'BTFBL');
select t_eq('project read from form name', (select p.name from leads l join projects p on p.id = l.project_id where l.id = (select (v ->> 'lead_id')::uuid from rr where k = 'a')), 'Migsun');
select t_eq('intake person gets it', (select assigned_to from leads where id = (select (v ->> 'lead_id')::uuid from rr where k = 'a')), '11111111-0000-0000-0000-000000000003'::uuid);
select t_eq('default priority High', (select priority from leads where id = (select (v ->> 'lead_id')::uuid from rr where k = 'a')), 'High');
select t_eq('budget from answers', (select budget_band from leads where id = (select (v ->> 'lead_id')::uuid from rr where k = 'a')), '1Cr-1.5Cr');
select t_eq('location from answers', (select location_pref from leads where id = (select (v ->> 'lead_id')::uuid from rr where k = 'a')), 'Shaheed Path');
select t_eq('BHK from answers', (select bhk from leads where id = (select (v ->> 'lead_id')::uuid from rr where k = 'a')), '3 BHK');
select t_eq('timing from answers', (select possession_pref from leads where id = (select (v ->> 'lead_id')::uuid from rr where k = 'a')), 'Within 3 months');

insert into rr select 'b', ingest_lead(route_endpoint('meta', '4885', 'F-HAND'), jsonb_build_object(
  'provider', 'meta', 'external_id', 'RT-2', 'phone', '7700000951', 'form_name', 'MIGSUN - DFBL'));
select t_eq('a form set by hand keeps its own source', (select s.name from leads l join sources s on s.id = l.source_id where l.id = (select (v ->> 'lead_id')::uuid from rr where k = 'b')), 'HFBL');
select t_eq('a form set by hand keeps its own project', (select project_id from leads where id = (select (v ->> 'lead_id')::uuid from rr where k = 'b')), 'bbbbbbbb-0000-0000-0000-000000000001'::uuid);
select t_eq('no default priority means Medium', (select priority from leads where id = (select (v ->> 'lead_id')::uuid from rr where k = 'b')), 'Medium');

-- the same person on the same project again is a re-enquiry, matched on the project read from the name
insert into rr select 'c', ingest_lead(route_endpoint('meta', '4885', 'F-NEW2'), jsonb_build_object(
  'provider', 'meta', 'external_id', 'RT-3', 'phone', '+447449973282', 'form_name', 'MIGSUN - DFBL second form'));
select t_eq('same person, same project: re-enquiry', (select (v ->> 'reenquiry')::boolean from rr where k = 'c'), true);

-- an inactive intake person falls back to round robin
update profiles set active = false where id = '11111111-0000-0000-0000-000000000003';
insert into rr select 'd', ingest_lead(route_endpoint('meta', '4885', 'F-NEW'), jsonb_build_object(
  'provider', 'meta', 'external_id', 'RT-4', 'phone', '7700000952', 'form_name', 'Rishita - DFBL'));
select t_eq('inactive intake person is skipped', (select assigned_to is distinct from '11111111-0000-0000-0000-000000000003'::uuid from leads where id = (select (v ->> 'lead_id')::uuid from rr where k = 'd')), true);
update profiles set active = true where id = '11111111-0000-0000-0000-000000000003';
do $$ begin raise notice 'ALL META ROUTING TESTS PASSED'; end $$;
reset role;
insert into projects(name, aliases) values ('Centre Point Ayodhya', array['CPA']) on conflict (name) do update set aliases = excluded.aliases;
select t_eq('project found by alias', (select name from projects where id = project_from_text('CPA - HFBL')), 'Centre Point Ayodhya');
select t_eq('alias needs a whole word', project_from_text('CPAX - DFBL'), null::uuid);
do $$ begin raise notice 'ALL PROJECT ALIAS TESTS PASSED'; end $$;
