-- Relive CRM 0026: ad campaign monitoring inside the CRM (applied to production 10 Nov 2026, with the 0026b flag fix folded in).
--  1. Daily spend, impressions, clicks and Meta-counted leads per monitored campaign, fetched straight from the Meta Insights API
--     (server-side token in private.secrets) by private.ad_monitor_sync(). Independent of the web app's insights pull.
--  2. private.ad_monitor_leads: every CRM lead from a monitored campaign (matched by campaign id or form id), with form answers
--     parsed by key pattern (based / budget / space / planning / connect), stage, lost reason and minutes to first contact.
--  3. private.ad_monitor_kpis(): cost per lead, % budget >= Rs 50 L, % wrong segment, % contacted within 1 h, qualified/visits/bookings,
--     cost per qualified lead, splits by space / country / budget. public.ad_monitor_summary() exposes it to admins only.
--  4. Alerts to active admins through public.notify() (kind 'ad_monitor'), each fired once per key: uncontacted lead > 2 h,
--     Meta vs CRM lead mismatch, spend with no leads, cost per lead / wrong segment / low budget over threshold, morning digest.
-- Schedules are in supabase/cron.sql (pg_cron is not available in the local test database).
-- To monitor another campaign: insert a row into private.ad_monitors.
-- Safe to run twice.

-- ---------- tables ----------
create table if not exists private.ad_monitors (
  campaign_id   text primary key,
  name          text not null,
  ad_account_id text not null,
  form_ids      text[] not null default '{}',
  active        boolean not null default true,
  thresholds    jsonb not null default '{}'::jsonb,
  last_fetch_at timestamptz,
  created_at    timestamptz not null default now()
);

create table if not exists private.ad_monitor_spend (
  campaign_id  text not null references private.ad_monitors(campaign_id) on delete cascade,
  day          date not null,
  spend        numeric not null default 0,
  impressions  bigint  not null default 0,
  clicks       bigint  not null default 0,
  meta_leads   integer not null default 0,
  refreshed_at timestamptz not null default now(),
  primary key (campaign_id, day)
);

create table if not exists private.ad_monitor_requests (
  request_id   bigint primary key,
  campaign_id  text not null,
  created_at   timestamptz not null default now(),
  processed_at timestamptz,
  error        text
);

create table if not exists private.ad_monitor_alerts (
  campaign_id text not null,
  alert_key   text not null,          -- e.g. 'cpl:2026-11-12', 'uncontacted:<lead uuid>'
  created_at  timestamptz not null default now(),
  primary key (campaign_id, alert_key)
);

-- ---------- helpers ----------
create or replace function private.answer_like(a jsonb, pat text)
returns text language sql immutable as $$
  select value #>> '{}' from jsonb_each(coalesce(a, '{}'::jsonb)) where key ilike pat limit 1
$$;

-- One row per CRM lead that came from a monitored campaign (matched by campaign id or form id).
create or replace view private.ad_monitor_leads as
with links as (
  select m.campaign_id, e.lead_id, e.answers, coalesce(e.is_test, false) as is_test,
         row_number() over (partition by m.campaign_id, e.lead_id order by e.received_at nulls last, e.created_at) as rn
  from private.ad_monitors m
  join public.enquiries e
    on e.lead_id is not null
   and (e.campaign_id = m.campaign_id or e.form_id = any(m.form_ids))
)
select k.campaign_id,
       l.id                                   as lead_id,
       l.created_at,
       (l.created_at at time zone 'Asia/Kolkata')::date as day_ist,
       k.is_test,
       coalesce(private.answer_like(k.answers, '%based%'), private.answer_like(k.answers, '%where_are_you_from%')) as residence,
       private.answer_like(k.answers, '%budget%')                       as budget_band,
       private.answer_like(k.answers, '%space%')                        as space_interest,
       coalesce(private.answer_like(k.answers, '%planning%'), private.answer_like(k.answers, '%timeline%')) as timeline,
       private.answer_like(k.answers, '%connect%')                      as connect_window,
       s.name                                                           as stage,
       lr.name                                                          as lost_reason,
       l.qualification,
       l.first_contacted_at,
       extract(epoch from (l.first_contacted_at - l.created_at)) / 60.0 as minutes_to_contact,
       l.converted_at,
       coalesce(private.answer_like(k.answers, '%budget%') is not null
        and private.answer_like(k.answers, '%budget%') not ilike 'under%', false) as budget_ok,
       coalesce(lr.name in ('Wrong client segment', 'Wrong info', 'Wrong or invalid number'), false) as wrong_segment,
       coalesce(s.name in ('Site Visit Scheduled', 'Site Visit Done', 'Negotiation', 'Booked'), false)
        or coalesce(l.qualification ilike 'qualified%', false)          as qualified,
       coalesce(s.name in ('Site Visit Done', 'Negotiation', 'Booked'), false) as visited,
       coalesce(s.name = 'Booked', false) or l.converted_at is not null  as booked
from links k
join public.leads l on l.id = k.lead_id
left join public.stages s on s.id = l.stage_id
left join public.lost_reasons lr on lr.id = l.lost_reason_id
where k.rn = 1;

-- ---------- KPIs ----------
create or replace function private.ad_monitor_kpis(p_campaign text, p_from date, p_to date)
returns jsonb language sql stable security definer set search_path = private, public as $$
  with sp as (
    select coalesce(sum(spend),0) spend, coalesce(sum(impressions),0) impressions,
           coalesce(sum(clicks),0) clicks, coalesce(sum(meta_leads),0) meta_leads
    from private.ad_monitor_spend where campaign_id = p_campaign and day between p_from and p_to
  ), ld as (
    select * from private.ad_monitor_leads
    where campaign_id = p_campaign and not is_test and day_ist between p_from and p_to
  ), agg as (
    select count(*) n,
           count(*) filter (where budget_ok) n_budget_ok,
           count(*) filter (where budget_band is not null) n_budget_answered,
           count(*) filter (where wrong_segment) n_wrong,
           count(*) filter (where minutes_to_contact <= 60) n_contact_1h,
           count(*) filter (where first_contacted_at is null) n_uncontacted,
           percentile_cont(0.5) within group (order by minutes_to_contact) median_min_contact,
           count(*) filter (where qualified) n_qualified,
           count(*) filter (where visited) n_visited,
           count(*) filter (where booked) n_booked
    from ld
  )
  select jsonb_build_object(
    'campaign_id', p_campaign, 'from', p_from, 'to', p_to,
    'spend', round(sp.spend), 'impressions', sp.impressions, 'clicks', sp.clicks,
    'meta_leads', sp.meta_leads, 'crm_leads', agg.n,
    'cpl', case when agg.n > 0 then round(sp.spend / agg.n) end,
    'pct_budget_50l_plus', case when agg.n_budget_answered > 0 then round(100.0 * agg.n_budget_ok / agg.n_budget_answered) end,
    'pct_wrong_segment', case when agg.n > 0 then round(100.0 * agg.n_wrong / agg.n) end,
    'pct_contacted_1h', case when agg.n > 0 then round(100.0 * agg.n_contact_1h / agg.n) end,
    'uncontacted', agg.n_uncontacted,
    'median_minutes_to_contact', round(agg.median_min_contact::numeric),
    'qualified', agg.n_qualified, 'visited', agg.n_visited, 'booked', agg.n_booked,
    'cost_per_qualified', case when agg.n_qualified > 0 then round(sp.spend / agg.n_qualified) end,
    'by_space',   (select jsonb_object_agg(coalesce(space_interest,'(blank)'), c) from (select space_interest, count(*) c from ld group by 1) x),
    'by_country', (select jsonb_object_agg(coalesce(residence,'(blank)'), c) from (select residence, count(*) c from ld group by 1) x),
    'by_budget',  (select jsonb_object_agg(coalesce(budget_band,'(blank)'), c) from (select budget_band, count(*) c from ld group by 1) x)
  ) from sp, agg
$$;

-- Admin-only RPC for a CRM screen: select public.ad_monitor_summary('<campaign_id>', 7);
create or replace function public.ad_monitor_summary(p_campaign text, p_days int default 7)
returns jsonb language plpgsql stable security definer set search_path = private, public as $$
declare v_today date := (now() at time zone 'Asia/Kolkata')::date;
begin
  if not exists (select 1 from public.profiles where id = auth.uid() and role = 'admin' and active) then
    raise exception 'not allowed';
  end if;
  return private.ad_monitor_kpis(p_campaign, v_today - greatest(p_days,1) + 1, v_today);
end $$;

-- ---------- Meta spend sync (every 30 min; fetches each campaign every 6 h) ----------
create or replace function private.ad_monitor_sync()
returns void language plpgsql security definer set search_path = private, public as $$
declare r record; resp record; d jsonb; tok text;
begin
  -- 1) store finished responses
  for r in select request_id, campaign_id, created_at from private.ad_monitor_requests where processed_at is null loop
    select status_code, content into resp from net._http_response where id = r.request_id;
    if not found then
      update private.ad_monitor_requests set processed_at = now(), error = 'no response'
       where request_id = r.request_id and r.created_at < now() - interval '1 hour';
      continue;
    end if;
    if resp.status_code = 200 then
      for d in select value from jsonb_array_elements(coalesce((resp.content::jsonb)->'data', '[]'::jsonb)) loop
        insert into private.ad_monitor_spend (campaign_id, day, spend, impressions, clicks, meta_leads, refreshed_at)
        values (r.campaign_id, (d->>'date_start')::date,
                coalesce((d->>'spend')::numeric, 0), coalesce((d->>'impressions')::bigint, 0), coalesce((d->>'clicks')::bigint, 0),
                coalesce((select (a->>'value')::int from jsonb_array_elements(coalesce(d->'actions','[]'::jsonb)) a
                           where a->>'action_type' in ('lead','onsite_conversion.lead_grouped')
                           order by (a->>'action_type' = 'lead') desc limit 1), 0),
                now())
        on conflict (campaign_id, day) do update
          set spend = excluded.spend, impressions = excluded.impressions, clicks = excluded.clicks,
              meta_leads = excluded.meta_leads, refreshed_at = now();
      end loop;
      update private.ad_monitor_requests set processed_at = now() where request_id = r.request_id;
    else
      update private.ad_monitor_requests set processed_at = now(), error = left(resp.content, 500) where request_id = r.request_id;
    end if;
  end loop;

  -- 2) fire new fetches
  select value into tok from private.secrets where key = 'meta_access_token';
  if tok is null then return; end if;
  for r in select campaign_id from private.ad_monitors
            where active and (last_fetch_at is null or last_fetch_at < now() - interval '6 hours') loop
    insert into private.ad_monitor_requests (request_id, campaign_id)
    values (net.http_get('https://graph.facebook.com/v21.0/' || r.campaign_id ||
              '/insights?time_increment=1&date_preset=last_30d&limit=100&fields=spend,impressions,clicks,actions&access_token=' || tok),
            r.campaign_id);
    update private.ad_monitors set last_fetch_at = now() where campaign_id = r.campaign_id;
  end loop;
end $$;

-- ---------- alerts ----------
create or replace function private.ad_monitor_alert(p_campaign text, p_key text, p_title text, p_body text, p_lead uuid default null)
returns void language plpgsql security definer set search_path = private, public as $$
declare u record;
begin
  insert into private.ad_monitor_alerts (campaign_id, alert_key) values (p_campaign, p_key)
  on conflict do nothing;
  if not found then return; end if;            -- already alerted for this key
  for u in select id from public.profiles where role = 'admin' and active loop
    perform public.notify(u.id, 'ad_monitor', p_title, p_body, p_lead, null);
  end loop;
end $$;

create or replace function private.ad_monitor_check(p_daily boolean default false)
returns void language plpgsql security definer set search_path = private, public as $$
declare
  m record; t jsonb; l record; k7 jsonb; k1 jsonb;
  v_today date := (now() at time zone 'Asia/Kolkata')::date;
  v_meta int; v_crm int; v_spend numeric; v_leads int;
begin
  for m in select * from private.ad_monitors where active loop
    t := m.thresholds;

    -- hourly: leads not contacted
    for l in select lead_id, residence, created_at from private.ad_monitor_leads
              where campaign_id = m.campaign_id and not is_test and first_contacted_at is null
                and coalesce(lost_reason,'') = ''
                and created_at < now() - make_interval(mins => coalesce((t->>'max_uncontacted_minutes')::int, 120))
                and created_at > now() - interval '3 days' loop
      perform private.ad_monitor_alert(m.campaign_id, 'uncontacted:' || l.lead_id,
        m.name || ': lead not contacted',
        'A ' || coalesce(l.residence, 'NRI') || ' lead from ' || to_char(l.created_at at time zone 'Asia/Kolkata', 'DD Mon HH24:MI') ||
        ' IST has not been contacted yet.', l.lead_id);
    end loop;

    -- hourly: Meta counted more leads than reached the CRM (last 2 full days)
    for l in select gs::date as day from generate_series(v_today - 2, v_today - 1, interval '1 day') gs loop
      select coalesce(sum(meta_leads),0) into v_meta from private.ad_monitor_spend where campaign_id = m.campaign_id and day = l.day;
      select count(*) into v_crm from private.ad_monitor_leads where campaign_id = m.campaign_id and not is_test and day_ist = l.day;
      if v_meta > v_crm + coalesce((t->>'mismatch_tolerance')::int, 1) then
        perform private.ad_monitor_alert(m.campaign_id, 'mismatch:' || l.day,
          m.name || ': leads missing in CRM',
          'Meta counted ' || v_meta || ' leads on ' || to_char(l.day, 'DD Mon') || ' but only ' || v_crm ||
          ' reached the CRM. Check the Meta webhook / Page subscription.');
      end if;
    end loop;

    if p_daily then
      k7 := private.ad_monitor_kpis(m.campaign_id, v_today - 7, v_today - 1);
      k1 := private.ad_monitor_kpis(m.campaign_id, v_today - 1, v_today - 1);

      -- spending but no leads (48h)
      select coalesce(sum(spend),0) into v_spend from private.ad_monitor_spend where campaign_id = m.campaign_id and day >= v_today - 2;
      select count(*) into v_leads from private.ad_monitor_leads where campaign_id = m.campaign_id and not is_test and created_at > now() - interval '48 hours';
      if v_spend >= coalesce((t->>'noleads_min_spend')::numeric, 300) and v_leads = 0 then
        perform private.ad_monitor_alert(m.campaign_id, 'noleads:' || v_today, m.name || ': spending but no leads',
          '₹' || round(v_spend) || ' spent in the last 48 h with no leads in the CRM.');
      end if;

      if (k7->>'crm_leads')::int >= 3 and (k7->>'cpl')::numeric > coalesce((t->>'max_cpl')::numeric, 1500) then
        perform private.ad_monitor_alert(m.campaign_id, 'cpl:' || v_today, m.name || ': cost per lead high',
          '7-day cost per lead ₹' || (k7->>'cpl') || ' (limit ₹' || coalesce(t->>'max_cpl','1500') || ').');
      end if;

      if (k7->>'crm_leads')::int >= coalesce((t->>'min_leads')::int, 5) then
        if (k7->>'pct_wrong_segment')::numeric > coalesce((t->>'max_wrong_segment_pct')::numeric, 25) then
          perform private.ad_monitor_alert(m.campaign_id, 'wrongseg:' || v_today, m.name || ': too many wrong-segment leads',
            (k7->>'pct_wrong_segment') || '% of last 7 days'' leads marked wrong segment / invalid.');
        end if;
        if 100 - coalesce((k7->>'pct_budget_50l_plus')::numeric, 100) > coalesce((t->>'max_low_budget_pct')::numeric, 50) then
          perform private.ad_monitor_alert(m.campaign_id, 'lowbudget:' || v_today, m.name || ': low budgets',
            'Only ' || (k7->>'pct_budget_50l_plus') || '% of last 7 days'' leads chose ₹50 L or more.');
        end if;
      end if;

      -- morning digest (only when there is activity)
      if (k7->>'spend')::numeric > 0 or (k7->>'crm_leads')::int > 0 then
        perform private.ad_monitor_alert(m.campaign_id, 'digest:' || v_today,
          m.name || ': yesterday ' || (k1->>'crm_leads') || ' leads, ₹' || (k1->>'spend') || ' spent',
          'Yesterday: ₹' || (k1->>'spend') || ', ' || (k1->>'meta_leads') || ' Meta / ' || (k1->>'crm_leads') || ' CRM leads' ||
          coalesce(', CPL ₹' || (k1->>'cpl'), '') || '. Last 7 days: ₹' || (k7->>'spend') || ', ' || (k7->>'crm_leads') || ' leads' ||
          coalesce(', CPL ₹' || (k7->>'cpl'), '') ||
          coalesce(', ' || (k7->>'pct_budget_50l_plus') || '% budget ≥ ₹50 L', '') ||
          coalesce(', ' || (k7->>'pct_contacted_1h') || '% contacted within 1 h', '') ||
          ', ' || (k7->>'qualified') || ' qualified, ' || (k7->>'visited') || ' visits, ' || (k7->>'booked') || ' booked.');
      end if;
    end if;
  end loop;
end $$;

-- ---------- permissions ----------
revoke all on function private.answer_like(jsonb, text) from public;
revoke all on function private.ad_monitor_kpis(text, date, date) from public;
revoke all on function private.ad_monitor_sync() from public;
revoke all on function private.ad_monitor_alert(text, text, text, text, uuid) from public;
revoke all on function private.ad_monitor_check(boolean) from public;
revoke all on function public.ad_monitor_summary(text, int) from public, anon;
grant execute on function public.ad_monitor_summary(text, int) to authenticated;

-- ---------- seed: HFBL relaunch ----------
insert into private.ad_monitors (campaign_id, name, ad_account_id, form_ids, thresholds)
values ('52654053922422', 'HFBL relaunch', '27001764176169052', array['1126952659979662'],
        '{"max_cpl":1500,"max_wrong_segment_pct":25,"max_low_budget_pct":50,"min_leads":5,
          "max_uncontacted_minutes":120,"mismatch_tolerance":1,"noleads_min_spend":300}'::jsonb)
on conflict (campaign_id) do nothing;
