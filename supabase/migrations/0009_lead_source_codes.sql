-- Relive CRM 0009: Relive marks who supplied a lead with its lead source code (DFBL, SFBL, IIA LEAD...),
-- exactly as in Cratio, not with a separate vendor. Imported leads move from "Facebook Lead Ads + vendor D"
-- to lead source DFBL; vendors are switched off (kept, not deleted). Channel (Facebook, Google...) stays separate.
insert into sources(name) values ('DFBL'), ('SFBL'), ('AFBL'), ('BTFBL'), ('HFBL'), ('ADFBL'),
  ('IIA LEAD'), ('PNB LEAD'), ('BATA CLIENT LEAD'), ('MI DATA')
on conflict (name) do nothing;

update leads l set source_id = s.id, vendor_id = null
  from sources s
 where l.import_ref is not null
   and s.name = upper(btrim(l.legacy ->> 'Lead Source'))
   and upper(btrim(l.legacy ->> 'Lead Source')) in ('DFBL','SFBL','AFBL','BTFBL','HFBL','ADFBL','IIA LEAD','PNB LEAD','BATA CLIENT LEAD','MI DATA');

update enquiries e set source_id = s.id
  from sources s
 where e.provider = 'cratio' and s.name = upper(btrim(e.raw_payload #>> '{legacy,Lead Source}'))
   and upper(btrim(e.raw_payload #>> '{legacy,Lead Source}')) in ('DFBL','SFBL','AFBL','BTFBL','HFBL','ADFBL','IIA LEAD','PNB LEAD','BATA CLIENT LEAD','MI DATA');

update vendors set active = false where active;
update sources set active = false where name = 'Partner data'
  and not exists (select 1 from leads where source_id = sources.id);
