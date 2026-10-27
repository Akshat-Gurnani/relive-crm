-- Relive CRM 0011: one search box finds a lead by customer name, phone, the owner it is assigned to, or its
-- owner in Cratio (for imported leads not yet linked to a login). The text lives in its own table, so keeping it
-- current never touches a lead's "last updated" date or the audit log.
create schema if not exists extensions;
create extension if not exists pg_trgm with schema extensions;

create table lead_search (
  lead_id uuid primary key references leads(id) on delete cascade,
  search_text text not null
);
create index lead_search_trgm on lead_search using gin (search_text extensions.gin_trgm_ops);
alter table lead_search enable row level security;
-- readable exactly where the lead itself is
create policy lead_search_read on lead_search for select to authenticated using (public.can_see_lead_id(lead_id));

create or replace function public.lead_search_text(p_person uuid, p_owner uuid, p_legacy jsonb) returns text
language sql stable security definer set search_path = public as $$
  select lower(concat_ws(' ',
    (select full_name from people where id = p_person),
    (select phone_e164 from people where id = p_person),
    (select full_name from profiles where id = p_owner),
    p_legacy ->> 'Owner in Cratio'))
$$;

create or replace function public.leads_search_sync() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' or new.person_id is distinct from old.person_id or new.assigned_to is distinct from old.assigned_to
     or new.legacy is distinct from old.legacy then
    insert into lead_search(lead_id, search_text) values (new.id, public.lead_search_text(new.person_id, new.assigned_to, new.legacy))
    on conflict (lead_id) do update set search_text = excluded.search_text;
  end if;
  return null;
end $$;
create trigger leads_search_sync after insert or update on leads
  for each row execute function public.leads_search_sync();

-- a renamed customer or staff member is found under the new name
create or replace function public.people_search_sync() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.full_name is distinct from old.full_name or new.phone_e164 is distinct from old.phone_e164 then
    update lead_search s set search_text = public.lead_search_text(l.person_id, l.assigned_to, l.legacy)
      from leads l where l.id = s.lead_id and l.person_id = new.id;
  end if;
  return null;
end $$;
create trigger people_search_sync after update on people for each row execute function public.people_search_sync();

create or replace function public.profiles_search_sync() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.full_name is distinct from old.full_name then
    update lead_search s set search_text = public.lead_search_text(l.person_id, l.assigned_to, l.legacy)
      from leads l where l.id = s.lead_id and l.assigned_to = new.id;
  end if;
  return null;
end $$;
create trigger profiles_search_sync after update on profiles for each row execute function public.profiles_search_sync();

insert into lead_search(lead_id, search_text)
select id, public.lead_search_text(person_id, assigned_to, legacy) from leads
on conflict (lead_id) do nothing;
