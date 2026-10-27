-- Minimal stand-ins for Supabase so the migration can run locally. Safe to re-run.
do $$ begin
  if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname='service_role') then create role service_role nologin bypassrls; end if;
end $$;
drop schema if exists auth cascade;
create schema auth;
create table auth.users (id uuid primary key default gen_random_uuid(), email text);
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
grant usage on schema auth to authenticated, service_role, anon;
grant usage on schema public to authenticated, service_role, anon;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to authenticated, service_role;
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
create function auth.role() returns text language sql stable as $$
  select nullif(current_setting('request.jwt.claim.role', true), '') $$;
