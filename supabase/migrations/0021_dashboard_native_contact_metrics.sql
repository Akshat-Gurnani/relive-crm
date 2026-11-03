-- Relive CRM 0021: contact metrics only from leads that arrived in this CRM.
-- Imported Cratio leads carry only their LAST call (3,623 of 26,337 calls), so "first contact" and "time to first call" for them
-- would really be the time of the last call. Totals still count every lead; contacted %, speed and the per-agent table use
-- native leads only, and the screen says how many imported leads were left out.
create or replace function public.dashboard_stats(p_from date, p_to date) returns jsonb
language plpgsql stable set search_path to 'public' as $$
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
                 'native_leads', count(*) filter (where l.import_ref is null),
                 'imported_leads', count(*) filter (where l.import_ref is not null),
                 'contacted', count(*) filter (where l.first_contacted_at is not null and l.import_ref is null),
                 'converted', count(*) filter (where l.converted_at is not null),
                 'lost', count(*) filter (where l.lost_at is not null),
                 'reenquiries', coalesce(sum(l.reenquiry_count), 0),
                 'avg_minutes_to_first_contact', round((avg(extract(epoch from (l.first_contacted_at - l.created_at)) / 60.0)
                     filter (where l.first_contacted_at is not null and l.import_ref is null))::numeric, 1))
               from leads l where l.created_at >= p_from and l.created_at < p_to + 1),
    'pipeline_by_stage', coalesce((select jsonb_agg(jsonb_build_object('stage_id', stage_id, 'leads', n))
               from (select stage_id, count(*) n from leads group by 1) s), '[]'),
    'by_source', coalesce((select jsonb_agg(jsonb_build_object('source_id', source_id, 'leads', n, 'contacted', c, 'converted', cv))
               from (select source_id, count(*) n, count(first_contacted_at) filter (where import_ref is null) c, count(converted_at) cv from leads
                      where created_at >= p_from and created_at < p_to + 1 group by 1) s), '[]'),
    'by_project', coalesce((select jsonb_agg(jsonb_build_object('project_id', project_id, 'leads', n, 'contacted', c, 'converted', cv))
               from (select project_id, count(*) n, count(first_contacted_at) filter (where import_ref is null) c, count(converted_at) cv from leads
                      where created_at >= p_from and created_at < p_to + 1 group by 1) s), '[]'),
    'by_agent', case when r in ('admin', 'manager') then coalesce((select jsonb_agg(jsonb_build_object(
                    'agent_id', assigned_to, 'leads', n, 'native', nat, 'contacted', c, 'converted', cv, 'avg_minutes', m))
               from (select assigned_to, count(*) n, count(*) filter (where import_ref is null) nat,
                            count(first_contacted_at) filter (where import_ref is null) c, count(converted_at) cv,
                            round((avg(extract(epoch from (first_contacted_at - created_at)) / 60.0)
                              filter (where first_contacted_at is not null and import_ref is null))::numeric, 1) m
                       from leads where created_at >= p_from and created_at < p_to + 1 group by 1) s), '[]')
                    else '[]'::jsonb end,
    'overdue_followups', (select count(*) from leads l join stages s on s.id = l.stage_id
                           where s.kind = 'open' and l.next_followup_at < now()));
end $$;
