-- 0026: Android app releases, so phones can update themselves.
-- An admin uploads a new APK in Admin > Phone app; every phone checks this table when the app opens
-- and offers the update. The APK files live in the public "app" storage bucket.

create table if not exists public.app_releases (
  id            uuid primary key default gen_random_uuid(),
  platform      text not null default 'android' check (platform in ('android')),
  version_code  integer not null check (version_code > 0),
  version_name  text not null,
  storage_path  text not null,
  size_bytes    bigint,
  notes         text,
  mandatory     boolean not null default false,
  active        boolean not null default true,
  published_by  uuid references public.profiles(id) on delete set null,
  created_at    timestamptz not null default now(),
  unique (platform, version_code)
);
create index if not exists app_releases_latest on public.app_releases (platform, active, version_code desc);

alter table public.app_releases enable row level security;
-- Version numbers and release notes are not secret: the phone checks before and after sign-in.
drop policy if exists app_releases_read on public.app_releases;
create policy app_releases_read on public.app_releases for select to anon, authenticated using (active);
-- Admins may switch a release off (for example a bad build). New releases are written by the server.
drop policy if exists app_releases_admin on public.app_releases;
create policy app_releases_admin on public.app_releases for update to authenticated
  using (public.app_current_role() = 'admin') with check (public.app_current_role() = 'admin');
grant select on public.app_releases to anon, authenticated;
grant update (active, notes, mandatory) on public.app_releases to authenticated;

-- Public bucket for the APK files (download links must work without signing in). Max 50 MB per file.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('app', 'app', true, 52428800, array['application/vnd.android.package-archive', 'application/octet-stream'])
on conflict (id) do update set public = true, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
