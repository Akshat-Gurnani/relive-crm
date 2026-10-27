-- Dashboard aggregates. Runs as the calling user (security invoker), so row level security decides what is counted.
-- Staff roles count their visible leads; marketing and viewers read the name-free marketing_funnel view instead.
-- pipeline_by_stage: all leads, current stage. Everything else: leads created between p_from and p_to.
create or replace function public.dashboard_stats(p_from date, p_to date)
returns jsonb language plpgsql stable security invoker set search_path = public as $$
declare
  r app_role := public.app_current_role();
  v jsonb;
begin
  if r is null then raise exception 'not a staff member' using errcode = '42501'; end if;

  if r in ('marketing', 'viewer') then
    v := jsonb_build_object(
      'role', r,
      'totals', (select jsonb_build_object('leads', coalesce(sum(leads), 0), 'contacted', coalesce(sum(contacted), 0),
                   'converted', coalesce(sum(converted), 0),
                   'avg_minutes_to_first_contact', round((sum(avg_minutes_to_first_contact * contacted) / nullif(sum(contacted), 0))::numeric, 1))
                 from marketing_funnel where month between date_trunc('month', p_from)::date and p_to),
      'pipeline_by_stage', coalesce((select jsonb_agg(jsonb_build_object('stage_id', stage_id, 'leads', n))
                 from (select stage_id, sum(leads) n from marketing_funnel group by 1) s), '[]'),
      'by_source', coalesce((select jsonb_agg(jsonb_build_object('source_id', source_id, 'leads', n, 'contacted', c, 'converted', cv))
                 from (select source_id, sum(leads) n, sum(contacted) c, sum(converted) cv from marketing_funnel
                        where month between date_trunc('month', p_from)::date and p_to group by 1) s), '[]'),
      'by_project', coalesce((select jsonb_agg(jsonb_build_object('project_id', project_id, 'leads', n, 'contacted', c, 'converted', cv))
                 from (select project_id, sum(leads) n, sum(contacted) c, sum(converted) cv from marketing_funnel
                        where month between date_trunc('month', p_from)::date and p_to group by 1) s), '[]'),
      'by_agent', '[]'::jsonb,
      'overdue_followups', null);
    return v;
  end if;

  return jsonb_build_object(
    'role', r,
    'totals', (select jsonb_build_object(
                 'leads', count(*),
                 'contacted', count(*) filter (where l.first_contacted_at is not null),
                 'converted', count(*) filter (where l.converted_at is not null),
                 'lost', count(*) filter (where l.lost_at is not null),
                 'reenquiries', coalesce(sum(l.reenquiry_count), 0),
                 'avg_minutes_to_first_contact', round((avg(extract(epoch from (l.first_contacted_at - l.created_at)) / 60.0)
                     filter (where l.first_contacted_at is not null))::numeric, 1))
               from leads l where l.created_at >= p_from and l.created_at < p_to + 1),
    'pipeline_by_stage', coalesce((select jsonb_agg(jsonb_build_object('stage_id', stage_id, 'leads', n))
               from (select stage_id, count(*) n from leads group by 1) s), '[]'),
    'by_source', coalesce((select jsonb_agg(jsonb_build_object('source_id', source_id, 'leads', n, 'contacted', c, 'converted', cv))
               from (select source_id, count(*) n, count(first_contacted_at) c, count(converted_at) cv from leads
                      where created_at >= p_from and created_at < p_to + 1 group by 1) s), '[]'),
    'by_project', coalesce((select jsonb_agg(jsonb_build_object('project_id', project_id, 'leads', n, 'contacted', c, 'converted', cv))
               from (select project_id, count(*) n, count(first_contacted_at) c, count(converted_at) cv from leads
                      where created_at >= p_from and created_at < p_to + 1 group by 1) s), '[]'),
    'by_agent', case when r in ('admin', 'manager') then coalesce((select jsonb_agg(jsonb_build_object(
                    'agent_id', assigned_to, 'leads', n, 'contacted', c, 'converted', cv, 'avg_minutes', m))
               from (select assigned_to, count(*) n, count(first_contacted_at) c, count(converted_at) cv,
                            round((avg(extract(epoch from (first_contacted_at - created_at)) / 60.0)
                              filter (where first_contacted_at is not null))::numeric, 1) m
                       from leads where created_at >= p_from and created_at < p_to + 1 group by 1) s), '[]')
                    else '[]'::jsonb end,
    'overdue_followups', (select count(*) from leads l join stages s on s.id = l.stage_id
                           where s.kind = 'open' and l.next_followup_at < now()));
end $$;
revoke all on function public.dashboard_stats(date, date) from public, anon;
grant execute on function public.dashboard_stats(date, date) to authenticated;
