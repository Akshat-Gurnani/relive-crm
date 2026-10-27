-- Relive CRM 0012: AI Insights for top-level admins.
--   insights_snapshot() computes the patterns in the CRM's own leads: how each lead source, channel, project,
--   campaign, road, budget band, property type, BHK, city, qualification, owner, tag, interest, first-call speed and
--   arrival time performs (contacted, site visit, booked, lost), which factors lift or drag site visits (with a
--   confidence interval), the monthly trend, lost reasons, and the words that recur in remarks.
--   Guardrails: admins only; counts and rates only (no names, phones, emails or remark text); any group under 5
--   leads is folded into "Other (small groups)"; a remark word counts only if it appears on 5+ different leads
--   and is not part of any customer's or staff member's name.
--   ai_queries keeps every question asked of the AI and its answer.

create or replace function public.insights_snapshot(p_from date default null, p_to date default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_from timestamptz := coalesce(p_from, '2000-01-01')::timestamp at time zone 'Asia/Kolkata';
  v_to timestamptz := (coalesce(p_to, (now() at time zone 'Asia/Kolkata')::date) + 1)::timestamp at time zone 'Asia/Kolkata';
  k constant int := 5;  -- smallest group shown on its own
  v jsonb;
begin
  if public.app_current_role() is distinct from 'admin' then
    raise exception 'AI Insights are for admins only' using errcode = '42501';
  end if;

  with base as (
    select l.id,
           coalesce(so.name, 'No source') source, coalesce(l.provider, 'Not set') channel,
           coalesce(pr.name, 'No project') project, coalesce(l.campaign_name, 'No campaign') campaign,
           coalesce(l.location_pref, 'Not captured') road, coalesce(l.budget_band, 'Not captured') budget,
           coalesce(l.property_type, 'Not captured') ptype, coalesce(l.bhk, 'Not captured') bhk,
           coalesce(initcap(nullif(btrim(pe.city), '')), 'Not captured') city,
           coalesce(l.qualification, 'Not checked') qual, l.temperature::text temp, coalesce(l.priority, 'Medium') priority,
           coalesce(ow.full_name, l.legacy ->> 'Owner in Cratio', 'Unassigned') owner,
           l.tags, l.interests, st.name stage, st.kind,
           case when l.first_contacted_at is null then '6 Never called'
                when l.first_contacted_at - l.created_at < interval '5 minutes' then '1 Under 5 min'
                when l.first_contacted_at - l.created_at < interval '30 minutes' then '2 5 to 30 min'
                when l.first_contacted_at - l.created_at < interval '2 hours' then '3 30 min to 2 h'
                when l.first_contacted_at - l.created_at < interval '24 hours' then '4 2 to 24 h'
                else '5 Over a day' end speed,
           to_char(l.created_at at time zone 'Asia/Kolkata', 'ID Dy') weekday,
           case when extract(hour from l.created_at at time zone 'Asia/Kolkata') < 9 then '1 Before 9 am'
                when extract(hour from l.created_at at time zone 'Asia/Kolkata') < 13 then '2 9 am to 1 pm'
                when extract(hour from l.created_at at time zone 'Asia/Kolkata') < 17 then '3 1 to 5 pm'
                when extract(hour from l.created_at at time zone 'Asia/Kolkata') < 21 then '4 5 to 9 pm'
                else '5 After 9 pm' end arrival,
           date_trunc('month', l.created_at at time zone 'Asia/Kolkata')::date mon,
           (l.first_contacted_at is not null) contacted,
           (l.converted_at is not null or exists (select 1 from site_visits sv where sv.lead_id = l.id and sv.done_at is not null)
              or st.name in ('Site Visit Done', 'Negotiation')) visited,
           (l.converted_at is not null) booked, (l.lost_at is not null) lost,
           lr.name lost_reason,
           (select count(*) from calls c where c.lead_id = l.id) calls,
           (select count(*) from calls c where c.lead_id = l.id and c.status = 'connected') connected
      from leads l
      join stages st on st.id = l.stage_id
      join people pe on pe.id = l.person_id
      left join sources so on so.id = l.source_id
      left join projects pr on pr.id = l.project_id
      left join profiles ow on ow.id = l.assigned_to
      left join lost_reasons lr on lr.id = l.lost_reason_id
     where l.created_at >= v_from and l.created_at < v_to
       and not ('Demo' = any(l.tags))),
  dims as (
    select b.*, d.dim, d.val from base b cross join lateral (values
      ('Lead source', b.source), ('Channel', b.channel), ('Project', b.project), ('Campaign', b.campaign),
      ('Road / location', b.road), ('Budget', b.budget), ('Property type', b.ptype), ('BHK', b.bhk), ('City', b.city),
      ('Qualification', b.qual), ('Temperature now', b.temp), ('Priority', b.priority), ('Owner', b.owner),
      ('First-call speed', b.speed), ('Day lead arrived', b.weekday), ('Time lead arrived', b.arrival)) d(dim, val)
    union all select b.*, 'Tag', t from base b, unnest(b.tags) t where t <> 'Demo'
    union all select b.*, 'Also interested in', i from base b, unnest(b.interests) i),
  grouped as (
    select dim, val, count(*) n, count(*) filter (where contacted) contacted, count(*) filter (where visited) visited,
           count(*) filter (where booked) booked, count(*) filter (where lost) lost,
           sum(calls) calls, sum(connected) connected
      from dims group by 1, 2),
  folded as (
    select dim, case when n < k then 'Other (small groups)' else val end val,
           sum(n) n, sum(contacted) contacted, sum(visited) visited, sum(booked) booked, sum(lost) lost,
           sum(calls) calls, sum(connected) connected
      from grouped group by 1, 2),
  tot as (
    select count(*) n, count(*) filter (where contacted) contacted, count(*) filter (where visited) visited,
           count(*) filter (where booked) booked, count(*) filter (where lost) lost, sum(calls) calls, sum(connected) connected
      from base),
  -- which factors lift or drag the site-visit rate; Wilson 95% interval so small samples are not over-read
  drivers as (
    select f.dim, f.val, f.n, f.visited,
           round(100.0 * f.visited / f.n, 1) visit_pct,
           round(100.0 * t.visited / nullif(t.n, 0), 1) overall_pct,
           round((f.visited::numeric / f.n) / nullif(t.visited::numeric / nullif(t.n, 0), 0), 2) lift,
           round(100 * ((f.visited::numeric / f.n + 1.9208 / f.n
                  - 1.96 * sqrt((f.visited::numeric / f.n) * (1 - f.visited::numeric / f.n) / f.n + 0.9604 / (f.n::numeric * f.n)))
                  / (1 + 3.8416 / f.n)), 1) low_pct,
           round(100 * ((f.visited::numeric / f.n + 1.9208 / f.n
                  + 1.96 * sqrt((f.visited::numeric / f.n) * (1 - f.visited::numeric / f.n) / f.n + 0.9604 / (f.n::numeric * f.n)))
                  / (1 + 3.8416 / f.n)), 1) high_pct
      from folded f, tot t
     where f.n >= 20 and f.val not like 'Other (small%' and f.dim not in ('Temperature now', 'Qualification'))
  select jsonb_build_object(
    'period', jsonb_build_object('from', coalesce(p_from::text, 'all time'), 'to', coalesce(p_to::text, 'today')),
    'note', 'Visited = site visit done or later. Groups under 5 leads are folded into "Other (small groups)".',
    'totals', (select to_jsonb(tot) from tot),
    'by', (select jsonb_object_agg(dim, rows) from (
             select dim, jsonb_agg(jsonb_build_object('value', val, 'leads', n, 'contacted', contacted, 'visited', visited,
                      'booked', booked, 'lost', lost, 'calls', calls, 'connected_calls', connected,
                      'visit_pct', round(100.0 * visited / nullif(n, 0), 1), 'booked_pct', round(100.0 * booked / nullif(n, 0), 1),
                      'lost_pct', round(100.0 * lost / nullif(n, 0), 1)) order by n desc) rows
               from folded group by dim) x),
    'drivers_up', coalesce((select jsonb_agg(to_jsonb(d) order by d.lift desc) from (
                    select * from drivers where low_pct > overall_pct order by lift desc limit 12) d), '[]'),
    'drivers_down', coalesce((select jsonb_agg(to_jsonb(d) order by d.lift) from (
                    select * from drivers where high_pct < overall_pct order by lift limit 12) d), '[]'),
    'monthly', coalesce((select jsonb_agg(jsonb_build_object('month', to_char(mon, 'Mon YYYY'), 'leads', n, 'contacted', c,
                    'visited', v2, 'booked', b2, 'lost', l2) order by mon) from (
                    select mon, count(*) n, count(*) filter (where contacted) c, count(*) filter (where visited) v2,
                           count(*) filter (where booked) b2, count(*) filter (where lost) l2 from base group by 1) m), '[]'),
    'lost_reasons', coalesce((select jsonb_agg(jsonb_build_object('reason', r, 'leads', n) order by n desc) from (
                    select coalesce(lost_reason, 'Not given') r, count(*) n from base where lost group by 1 having count(*) >= k) x), '[]'),
    'pipeline_now', coalesce((select jsonb_agg(jsonb_build_object('stage', stage, 'leads', n) order by n desc) from (
                    select stage, count(*) n from base group by 1) x), '[]'),
    'remark_words', (
      with name_parts as (  -- no word that is part of any customer's or staff member's name
        select distinct lower(t) tok from people, regexp_split_to_table(coalesce(full_name, ''), '[^A-Za-z]+') t where length(t) >= 3
        union select distinct lower(t) from profiles, regexp_split_to_table(full_name, '[^A-Za-z]+') t where length(t) >= 3),
      words as (
        select distinct b.id, b.lost, b.visited, w
          from base b
          join lateral (select string_agg(coalesce(body, ''), ' ') txt from lead_notes nt where nt.lead_id = b.id) n on true
          join leads l on l.id = b.id
          cross join lateral regexp_split_to_table(lower(coalesce(n.txt, '') || ' ' || coalesce(l.lost_remarks, '')), '[^a-z]+') w
         where length(w) between 4 and 20
           and w not in ('with','that','this','have','from','will','they','them','their','there','been','were','when','what',
                         'which','would','could','should','about','after','also','into','only','some','than','then','very',
                         'call','called','calls','client','customer','lead','said','told','asked','sent','send','details',
                         'please','sir','madam','today','tomorrow','again','time','back','more','just','want','wants')
           and w not in (select tok from name_parts))
      select jsonb_build_object(
        'in_lost_leads', coalesce((select jsonb_agg(jsonb_build_object('word', w, 'leads', n) order by n desc) from (
                          select w, count(*) n from words where lost group by 1 having count(*) >= k order by 2 desc limit 30) x), '[]'),
        'in_visited_leads', coalesce((select jsonb_agg(jsonb_build_object('word', w, 'leads', n) order by n desc) from (
                          select w, count(*) n from words where visited group by 1 having count(*) >= k order by 2 desc limit 30) x), '[]')))
  ) into v;
  return v;
end $$;
revoke all on function public.insights_snapshot(date, date) from public, anon;
grant execute on function public.insights_snapshot(date, date) to authenticated;

-- every question asked of the AI, and its answer (admins only)
create table ai_queries (
  id uuid primary key default gen_random_uuid(),
  asked_by uuid not null default auth.uid() references profiles(id),
  question text not null check (length(question) between 2 and 1000),
  answer text,
  model text,
  period text,
  error text,
  created_at timestamptz not null default now()
);
create index ai_queries_recent on ai_queries(created_at desc);
alter table ai_queries enable row level security;
create policy ai_queries_admin on ai_queries for all to authenticated
  using (public.app_current_role() = 'admin') with check (public.app_current_role() = 'admin' and asked_by = auth.uid());
