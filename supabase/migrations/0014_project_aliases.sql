-- Relive CRM 0014: other names a project goes by in Facebook form names ("CPA" for Centre Point Ayodhya,
-- "Purvanchal Atlantis" for Purvanchal Royal Atlantis), used when reading the project from a form name.
alter table projects add column aliases text[] not null default '{}';

create or replace function public.project_from_text(t text) returns uuid
language sql stable security definer set search_path = public as $$
  select id from (
    select p.id, length(n) len
      from projects p, unnest(array[p.name] || p.aliases) n
     where p.active and t is not null and length(n) >= 3
       and upper(regexp_replace(t, '[^A-Za-z0-9]+', ' ', 'g')) ~ ('(^| )' || upper(regexp_replace(n, '[^A-Za-z0-9]+', ' ', 'g')) || '( |$)')
  ) m order by len desc limit 1
$$;

update projects set aliases = array['CPA'] where name = 'Centre Point Ayodhya';
update projects set aliases = array['Purvanchal Atlantis'] where name = 'Purvanchal Royal Atlantis';
