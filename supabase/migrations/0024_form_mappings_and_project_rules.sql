-- Relive CRM 0024: Cratio-style lead distribution.
-- Cratio worked in two steps: (1) each Facebook lead form is mapped by hand to a product category (project), source and priority;
-- (2) a distribution rule per product category lists the people who take turns on it. This adds step 1 as an explicit table,
-- applied BEFORE rule matching, so a form no longer depends on its name to find its project. Step 2 already exists as routing
-- lists with "Only when project is" (match_project_id).

create table if not exists public.form_mappings (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,                                    -- Cratio's "Facebook Mapper Name"
  form_id     text not null unique,                             -- the Facebook lead form
  form_name   text,                                             -- name of that form on Facebook, for display
  project_id  uuid references public.projects(id) on delete restrict,   -- Cratio's "Product Category"
  source_id   uuid references public.sources(id),
  priority    text check (priority in ('High', 'Medium', 'Low')),
  assign_to   uuid references public.profiles(id),              -- Cratio's required "Assigned To": used only when no distribution rule catches the lead
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
alter table public.form_mappings enable row level security;
revoke all on public.form_mappings from anon;
grant select, insert, update, delete on public.form_mappings to authenticated;
drop policy if exists form_mappings_read on public.form_mappings;
create policy form_mappings_read on public.form_mappings for select to authenticated using (public.app_current_role() in ('admin', 'manager'));
drop policy if exists form_mappings_write on public.form_mappings;
create policy form_mappings_write on public.form_mappings for all to authenticated
  using (public.app_current_role() = 'admin') with check (public.app_current_role() = 'admin');

-- ingest_lead: look up the form's mapping before the rule is matched.
do $$
declare def text := pg_get_functiondef('public.ingest_lead'::regproc);
        patched text := def;
begin
  patched := replace(patched, '  rl routing_rules%rowtype;', E'  rl routing_rules%rowtype;\n  fm form_mappings%rowtype;');
  patched := replace(patched, '  v_rule := public.match_rule(p, ep.id, v_project);',
    E'  select * into fm from form_mappings where active and form_id = p ->> ''form_id'';\n'
    || E'  if found then\n    v_source := coalesce(fm.source_id, v_source);\n    v_project := coalesce(fm.project_id, v_project);\n  end if;\n\n'
    || '  v_rule := public.match_rule(p, ep.id, v_project);');
  patched := replace(patched, 'v_priority := coalesce(rl.set_priority, ep.default_priority, ''Medium'');',
                              'v_priority := coalesce(rl.set_priority, fm.priority, ep.default_priority, ''Medium'');');
  patched := replace(patched, 'select id into v_assignee from profiles where id = ep.assign_to and active;',
                              'select id into v_assignee from profiles where id = coalesce(fm.assign_to, ep.assign_to) and active;');
  if patched = def
     or position('fm form_mappings%rowtype' in patched) = 0
     or position('from form_mappings where active' in patched) = 0
     or position('rl.set_priority, fm.priority' in patched) = 0
     or position('coalesce(fm.assign_to, ep.assign_to)' in patched) = 0 then
    raise exception 'ingest_lead did not contain the expected text; nothing changed';
  end if;
  execute patched;
end $$;

-- preview_route (the "Test a lead" box) follows the same order: mapping first, then rule.
create or replace function public.preview_route(p jsonb, p_project uuid default null) returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare v_rule uuid; r routing_rules%rowtype; v_next uuid; fm form_mappings%rowtype; v_proj uuid; v_text text;
begin
  if public.app_current_role() is distinct from 'admin' then raise exception 'only admins can test routing' using errcode = '42501'; end if;
  v_text := concat_ws(' ', p ->> 'form_name', p ->> 'campaign_name', p ->> 'adset_name');
  select * into fm from form_mappings where active and form_id = p ->> 'form_id';
  v_proj := coalesce(p_project, fm.project_id, public.project_from_text(v_text));
  v_rule := public.match_rule(p, null, v_proj);
  if v_rule is null then return jsonb_build_object('rule', null, 'project', (select name from projects where id = v_proj)); end if;
  select * into r from routing_rules where id = v_rule;
  select m.user_id into v_next from routing_members m join profiles pr on pr.id = m.user_id
   where m.rule_id = v_rule and m.active and pr.active and pr.accepting_leads
   order by m.served / m.share, m.position, m.user_id limit 1;
  return jsonb_build_object('rule', r.name, 'rule_id', r.id, 'next', (select full_name from profiles where id = v_next),
                            'project', (select name from projects where id = coalesce(r.set_project_id, v_proj)),
                            'priority', coalesce(r.set_priority, fm.priority));
end $$;

-- Cratio product categories that have no project here yet. "Associate" and "LPM 75 LAC" are categories, not buildings, so they
-- start inactive: an inactive project is never guessed from a form name, but a mapping or rule can still use it.
insert into public.projects (name, city, active)
select v.name, null, v.active
  from (values ('Carousel HNI', true), ('CPA HNI', true), ('CPD HNI', true), ('Max HNI', true), ('VR HNI', true),
               ('Emaar Elara', true), ('LPM 75 LAC', false), ('Associate', false)) v(name, active)
 where not exists (select 1 from public.projects p where lower(p.name) = lower(v.name));

-- The 21 Cratio distribution rules, read from the live Cratio screen on 3 Nov 2026. Each is "project is X" with people in the
-- order Cratio listed them; everyone gets an equal share, as in Cratio. Safe to run twice.
do $$
declare r record; v_rule uuid; v_proj uuid; n int;
begin
  for r in
    select * from (values
      ('Migsun',                   array['Animesh','Sachin Giri','Vejiya','Alok','Alvia','Owais','Vikas']),
      ('Rishita Serenity',         array['Alvia','Sachin Giri','Owais']),
      ('Purvanchal Royal Atlantis',array['Sachin Giri','Owais','Alvia']),
      ('Jashn Elevate',            array['Owais','Alvia','Anand Mohan Chitranshi','Vejiya','Sachin Giri']),
      ('Carousel HNI',             array['Animesh']),
      ('Centre Point Ayodhya',     array['Anand Mohan Chitranshi','Vejiya','Sachin Giri','Alok','Vikas']),
      ('Hero Plots',               array['Alok','Sachin Giri']),
      ('Foresta Bareilly',         array['Sachin Giri','Alvia']),
      ('Shalimar KSMB',            array['Sachin Giri','Owais']),
      ('M3M',                      array['Animesh']),
      ('CPA HNI',                  array['Animesh']),
      ('CPD HNI',                  array['Animesh']),
      ('Max HNI',                  array['Animesh']),
      ('Omaxe Independent Floors', array['Owais','Vikas','Sachin Giri']),
      ('VR HNI',                   array['Animesh']),
      ('LPM 75 LAC',               array['Varsha Gurnani']),
      ('Associate',                array['Sachin Giri']),
      ('Eiffel Palm Vista',        array['Sachin Giri','Owais','Animesh']),
      ('Kutumb',                   array['Alvia','Alok','Vejiya','Owais']),
      ('Sahu City Pearl',          array['Vikas','Alvia','Vejiya','Alok']),
      ('Emaar Elara',              array['Varsha Gurnani'])
    ) t(project_name, people)
  loop
    select id into v_proj from public.projects where lower(name) = lower(r.project_name);
    if v_proj is null then raise exception 'project % not found', r.project_name; end if;
    select id into v_rule from public.routing_rules where match_project_id = v_proj and name = r.project_name;
    if v_rule is null then
      insert into public.routing_rules (name, position, match_project_id, note)
      values (r.project_name, 100, v_proj, 'From the Cratio distribution rule "Product Category IS ' || upper(r.project_name) || '"')
      returning id into v_rule;
    end if;
    n := 0;
    for i in 1 .. array_length(r.people, 1) loop
      insert into public.routing_members (rule_id, user_id, position, share)
      select v_rule, pr.id, i, 1 from public.profiles pr where lower(pr.full_name) = lower(r.people[i])
      on conflict (rule_id, user_id) do nothing;
      get diagnostics n = row_count;
      if n = 0 and not exists (select 1 from public.routing_members m join public.profiles pr on pr.id = m.user_id
                                where m.rule_id = v_rule and lower(pr.full_name) = lower(r.people[i])) then
        raise exception 'staff member % not found for %', r.people[i], r.project_name;
      end if;
    end loop;
  end loop;
end $$;
