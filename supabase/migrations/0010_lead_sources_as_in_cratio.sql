-- Relive CRM 0010: every imported lead's source is Cratio's own Lead Source name (RELIVE SELF, LPM 2.0 EVENT,
-- Facebook Campaign...). Case variants (Direct Lead / DIRECT LEAD) are merged under the spelling used most.
-- The event / own-Facebook name copied into Campaign is cleared (the source says it). Unused sources are switched off.
create temporary table canon as
with c as (
  select upper(btrim(legacy ->> 'Lead Source')) k, btrim(legacy ->> 'Lead Source') v, count(*) n
    from leads where import_ref is not null and coalesce(btrim(legacy ->> 'Lead Source'), '') <> '' group by 1, 2
  union all
  select upper(btrim(raw_payload #>> '{legacy,Lead Source}')), btrim(raw_payload #>> '{legacy,Lead Source}'), count(*)
    from enquiries where provider = 'cratio' and coalesce(btrim(raw_payload #>> '{legacy,Lead Source}'), '') <> '' group by 1, 2)
select distinct on (k) k, v from (select k, v, sum(n) n from c group by 1, 2) x order by k, n desc, v;

insert into sources(name) select v from canon on conflict (name) do nothing;
update sources set active = true where name in (select v from canon);

update leads l set source_id = s.id
  from canon join sources s on s.name = canon.v
 where l.import_ref is not null and upper(btrim(l.legacy ->> 'Lead Source')) = canon.k and l.source_id is distinct from s.id;

update enquiries e set source_id = s.id
  from canon join sources s on s.name = canon.v
 where e.provider = 'cratio' and upper(btrim(e.raw_payload #>> '{legacy,Lead Source}')) = canon.k and e.source_id is distinct from s.id;

update leads set campaign_name = null
 where import_ref is not null and campaign_name in ('Durga Pooja', 'Jashn', 'LPM 2.0', 'Joggers Park activity', 'Market activity',
   'Fbl T20', 'Relive Facebook', 'City Konnect Fb', 'UP Doctors Meet', 'Hindustan event', 'Lucknow Property Mahotsav');

update sources s set active = false
 where s.active and not exists (select 1 from leads l where l.source_id = s.id)
   and not exists (select 1 from capture_endpoints c where c.source_id = s.id)
   and not exists (select 1 from enquiries e where e.source_id = s.id);

drop table canon;
