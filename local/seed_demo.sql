-- Demo data for the local test stack. Fictional people and numbers (555-style test mobiles). Never load into production.
-- Every demo login uses the password: demo1234
do $$
declare
  pw text := extensions.crypt('demo1234', extensions.gen_salt('bf'));
  t_lko uuid; t_noi uuid;
  u record; i int; n int;
  firsts text[] := array['Aarav','Vivaan','Aditya','Vihaan','Arjun','Sai','Reyansh','Ayaan','Krishna','Ishaan','Ananya','Diya','Aadhya','Saanvi','Myra','Anika','Kiara','Riya','Meera','Pooja','Rahul','Amit','Sunil','Neha','Kavita','Manoj','Deepak','Suresh','Anjali','Rekha'];
  lasts text[] := array['Sharma','Verma','Singh','Gupta','Mishra','Tiwari','Yadav','Srivastava','Pandey','Agarwal','Khan','Rastogi','Saxena','Trivedi','Kapoor','Jain'];
  cities text[] := array['Lucknow','Lucknow','Lucknow','Kanpur','Noida','Delhi','Gurugram','Varanasi','Prayagraj','Dubai'];
  v_slugs text[]; v_slug text; r jsonb; lead_id uuid;
  stg_new uuid; stg_ytt uuid; stg_fu uuid; stg_svs uuid; stg_svd uuid; stg_neg uuid; stg_won uuid; stg_lost uuid;
  agents uuid[];
begin
  insert into teams(name) values ('Lucknow Sales'), ('Noida Sales') on conflict do nothing;
  select id into t_lko from teams where name='Lucknow Sales';
  select id into t_noi from teams where name='Noida Sales';

  -- staff: email, name, role, team
  for u in select * from (values
    ('admin@relive.test','Akshat Gurnani','admin',null::uuid),
    ('manager.lko@relive.test','Mohit Rastogi','manager',t_lko),
    ('manager.noi@relive.test','Seema Kapoor','manager',t_noi),
    ('priya@relive.test','Priya Singh','agent',t_lko),
    ('rohan@relive.test','Rohan Verma','agent',t_lko),
    ('sneha@relive.test','Sneha Gupta','agent',t_lko),
    ('aman@relive.test','Aman Khan','agent',t_noi),
    ('kavya@relive.test','Kavya Jain','agent',t_noi),
    ('marketing@relive.test','Samreen Ali','marketing',null::uuid)
  ) as x(email,name,role,team) loop
    insert into auth.users(email, encrypted_password) values (u.email, pw) on conflict (email) do nothing;
    insert into profiles(id, full_name, role, team_id)
      select id, u.name, u.role::app_role, u.team from auth.users where email = u.email
      on conflict (id) do nothing;
  end loop;
  -- stagger round-robin order so the first lead does not always go to the same agent
  update profiles set created_at = now() - interval '9 days' where full_name = 'Priya Singh';
  update profiles set created_at = now() - interval '8 days' where full_name = 'Rohan Verma';
  update profiles set created_at = now() - interval '7 days' where full_name = 'Sneha Gupta';
  update profiles set created_at = now() - interval '9 days' where full_name = 'Aman Khan';
  update profiles set created_at = now() - interval '8 days' where full_name = 'Kavya Jain';

  insert into developers(name) values ('Migsun'),('Omaxe'),('Purvanchal'),('Emaar'),('Joy Group'),('LPM') on conflict do nothing;
  insert into projects(name, developer_id, city) values
    ('Migsun Lucknow Central', (select id from developers where name='Migsun'), 'Lucknow'),
    ('Omaxe Amausi', (select id from developers where name='Omaxe'), 'Lucknow'),
    ('Joy Street', (select id from developers where name='Joy Group'), 'Lucknow'),
    ('Purvanchal Royal Atlantis', (select id from developers where name='Purvanchal'), 'Noida'),
    ('Emaar Elite Oasis', (select id from developers where name='Emaar'), 'Noida'),
    ('LPM 2.0', (select id from developers where name='LPM'), 'Noida')
  on conflict do nothing;
  insert into team_projects(team_id, project_id)
    select t_lko, id from projects where name in ('Migsun Lucknow Central','Omaxe Amausi','Joy Street') on conflict do nothing;
  insert into team_projects(team_id, project_id)
    select t_noi, id from projects where name in ('Purvanchal Royal Atlantis','Emaar Elite Oasis','LPM 2.0') on conflict do nothing;

  -- one capture endpoint per project; the secret for all of them is: demo-secret
  insert into capture_endpoints(slug, name, source_id, project_id, team_id, secret_hash)
    select lower(regexp_replace(p.name,'[^a-zA-Z0-9]+','-','g')), p.name || ' (Facebook form)',
           (select id from sources where name='Facebook Lead Ads'), p.id,
           (select team_id from team_projects tp where tp.project_id = p.id limit 1),
           encode(extensions.digest('demo-secret','sha256'),'hex')
      from projects p
    on conflict (slug) do nothing;

  select array_agg(ce.slug order by ce.slug) into v_slugs from capture_endpoints ce;

  -- leads through the real capture function, so assignment and phone cleaning are exercised
  for i in 1..140 loop
    v_slug := v_slugs[1 + (i % array_length(v_slugs,1))];
    r := capture_enquiry(v_slug, encode(extensions.digest('demo-secret','sha256'),'hex'), jsonb_build_object(
      'contact', firsts[1 + (i*7 % array_length(firsts,1))] || ' ' || lasts[1 + (i*11 % array_length(lasts,1))],
      'mobile', '9' || lpad(((i * 7919 + 1234567) % 1000000000)::text, 9, '0'),
      'city', cities[1 + (i % array_length(cities,1))],
      'category', (array['Yes, ready to buy','Within 3 months','Just exploring','Investment'])[1 + (i % 4)],
      'date', to_char(now() - ((i % 30) || ' days')::interval, 'YYYY-MM-DD"T"HH24:MI:SS"+05:30"')));
  end loop;

  -- a few repeat enquiries (same number, different wording and format)
  for i in 1..9 loop
    v_slug := v_slugs[1 + (i % array_length(v_slugs,1))];
    perform capture_enquiry(v_slug, encode(extensions.digest('demo-secret','sha256'),'hex'), jsonb_build_object(
      'contact', 'Repeat enquirer',
      'mobile', '+91 ' || substr(('9' || lpad(((i*3 * 7919 + 1234567) % 1000000000)::text, 9, '0')), 1, 5) || ' ' || substr(('9' || lpad(((i*3 * 7919 + 1234567) % 1000000000)::text, 9, '0')), 6),
      'category', 'Looking again after the site visit'));
  end loop;

  -- spread arrival dates over the last 30 days and give most leads a first contact
  update leads set created_at = now() - ((random()*29)::numeric || ' days')::interval - ((random()*600)::int || ' minutes')::interval;
  update leads set first_contacted_at = created_at + ((5 + random()*300)::int || ' minutes')::interval
    where random() < 0.75;
  -- keep the history consistent with the backdated arrival time
  update enquiries e set received_at = l.created_at + (e.created_at - (select min(e2.created_at) from enquiries e2 where e2.lead_id = e.lead_id)),
                         created_at = l.created_at + (e.created_at - (select min(e2.created_at) from enquiries e2 where e2.lead_id = e.lead_id))
    from leads l where l.id = e.lead_id;
  update lead_stage_history h set changed_at = l.created_at from leads l where l.id = h.lead_id;

  select id into stg_new from stages where name='New';
  select id into stg_ytt from stages where name='Yet To Talk';
  select id into stg_fu from stages where name='Follow-up';
  select id into stg_svs from stages where name='Site Visit Scheduled';
  select id into stg_svd from stages where name='Site Visit Done';
  select id into stg_neg from stages where name='Negotiation';
  select id into stg_won from stages where name='Booked';
  select id into stg_lost from stages where name='Lost';

  -- move leads through the funnel
  update leads set stage_id = stg_ytt where first_contacted_at is null and random() < 0.5;
  update leads set stage_id = stg_fu, temperature = (array['hot','warm','cold'])[1 + (random()*2)::int]::temperature
    where first_contacted_at is not null and random() < 0.45;
  update leads set stage_id = stg_svs where stage_id = stg_fu and random() < 0.4;
  update leads set stage_id = stg_svd where stage_id = stg_svs and random() < 0.7;
  update leads set stage_id = stg_neg where stage_id = stg_svd and random() < 0.7;
  update leads set stage_id = stg_won where stage_id = stg_neg and random() < 0.6;
  update leads set stage_id = stg_lost, lost_reason_id = (select id from lost_reasons order by random() limit 1)
    where first_contacted_at is not null and stage_id <> stg_won and random() < 0.15;

  update lead_stage_history h set changed_at = l.created_at + (random() * (now() - l.created_at))
    from leads l where l.id = h.lead_id and h.from_stage_id is not null;

  -- follow-ups: some overdue, some today, some later (open leads only)
  update leads l set next_followup_at = now() + ((random()*96 - 10) || ' hours')::interval,
                     next_followup_note = (array['Send brochure','Confirm site visit','Share payment plan','Ask about budget','Call after office hours'])[1 + (random()*4)::int]
    where stage_id in (select id from stages where kind = 'open') and first_contacted_at is not null and random() < 0.7;

  -- call history on contacted leads
  insert into activities(lead_id, type, outcome, notes, assigned_to, created_by, completed_at, created_at)
    select l.id, 'call', (array['Connected, interested','Connected, call later','No answer','Busy'])[1 + (random()*3)::int],
           'Demo call note', l.assigned_to, l.assigned_to, l.first_contacted_at, l.first_contacted_at
      from leads l where l.first_contacted_at is not null;
  update leads l set last_activity_at = greatest(l.created_at, l.first_contacted_at, l.last_activity_at - interval '0') where true;
  insert into site_visits(lead_id, project_id, scheduled_at, done_at)
    select id, project_id, now() - interval '3 days', case when stage_id in (stg_svd, stg_neg, stg_won) then now() - interval '3 days' end
      from leads where stage_id in (stg_svs, stg_svd, stg_neg, stg_won);

  -- 0003 data: staff phones, owner history, phone call logs, tasks, notes, attendance
  update profiles set phone = '+9190000' || lpad((abs(hashtext(full_name)) % 100000)::text, 5, '0') where phone is null;
  update leads set assigned_at = created_at where assigned_to is not null;
  update lead_assignments a set at = l.created_at from leads l where l.id = a.lead_id;
  insert into calls(person_id, lead_id, agent_id, direction, status, started_at, ended_at, duration_seconds, provider, provider_call_id, phone_e164, outcome)
    select l.person_id, l.id, l.assigned_to, 'outgoing',
           case when d > 0 then 'connected' else 'not_connected' end::call_status,
           t, t + make_interval(secs => d), d, 'android', 'demo-' || l.id || '-' || g, pe.phone_e164,
           case when d > 0 then (array['Connected, interested','Connected, call later','Connected, not interested'])[1 + (random()*2)::int] else 'No answer' end
      from leads l join people pe on pe.id = l.person_id,
           lateral generate_series(1, 1 + (random()*3)::int) g,
           lateral (select l.first_contacted_at + make_interval(hours => (g - 1) * (6 + (random()*40)::int)) as t,
                           case when random() < 0.45 then 0 else (20 + random()*400)::int end as d) x
     where l.first_contacted_at is not null and x.t < now();
  insert into calls(person_id, lead_id, agent_id, direction, status, started_at, ended_at, duration_seconds, provider, provider_call_id, phone_e164)
    select l.person_id, l.id, l.assigned_to, 'incoming', 'missed', now() - make_interval(hours => (random()*72)::int), null, 0, 'android', 'demo-in-' || l.id, pe.phone_e164
      from leads l join people pe on pe.id = l.person_id where l.first_contacted_at is not null and random() < 0.12;
  insert into tasks(lead_id, title, category, assigned_to, created_by, due_at, status, created_at)
    select l.id, (array['Send price sheet','Share brochure on WhatsApp','Confirm site visit pickup','Get budget confirmation','Call spouse as well'])[1 + (random()*4)::int],
           (array['Send details','Send details','Site visit','Call back','Call back'])[1 + (random()*4)::int],
           l.assigned_to, l.assigned_to, now() + make_interval(hours => (random()*72 - 24)::int),
           case when random() < 0.3 then 'done' else 'open' end, now() - interval '2 days'
      from leads l join stages s on s.id = l.stage_id where s.kind = 'open' and l.assigned_to is not null and random() < 0.35;
  insert into lead_notes(lead_id, body, created_by, created_at)
    select l.id, (array['Prefers east facing, higher floor.','Works in Dubai, decides with brother in Lucknow.','Wants possession within a year; loan pre-approved.','Asked for corner unit pricing.','Comparing with a project in Gomti Nagar Extension.'])[1 + (random()*4)::int],
           l.assigned_to, l.first_contacted_at + interval '10 minutes'
      from leads l where l.first_contacted_at is not null and random() < 0.3;
  insert into attendance(user_id, kind, at, lat, lng, accuracy_m, address, note, device)
    select p.id, k.kind, ((current_date - d)::timestamp + k.t) at time zone 'Asia/Kolkata' + make_interval(mins => (random()*25)::int),
           26.78 + random()*0.06, 80.95 + random()*0.08, 15, 'Golf City, Lucknow', null, 'android'
      from profiles p, generate_series(0, 6) d, (values ('in', time '09:40'), ('out', time '19:10')) k(kind, t)
     where p.role in ('agent', 'manager') and extract(isodow from current_date - d) < 7 and not (d = 0 and k.kind = 'out');
  -- last activity reflects the latest call, note or stage change
  update leads l set last_activity_at = greatest(l.created_at, coalesce(l.first_contacted_at, l.created_at),
      coalesce((select max(c.started_at) from calls c where c.lead_id = l.id and c.started_at <= now()), l.created_at),
      coalesce((select max(h.changed_at) from lead_stage_history h where h.lead_id = l.id), l.created_at));
  -- the demo starts with a clean bell: only the last day's alerts are unread
  update notifications set read_at = now(), pushed_at = now();
  update notifications n set read_at = null where n.created_at > now() - interval '1 minute'
    and n.id in (select id from notifications order by random() limit 12);
end $$;
