-- Relive CRM 0019: builder WhatsApp groups -> structured project updates.
-- A read-only bridge posts every group message here; an AI step turns messages into updates (inventory, price, offers,
-- marketing assets, construction news); risky kinds wait in a review queue, safe kinds publish themselves.

create table wa_groups (
  id uuid primary key default gen_random_uuid(),
  wa_jid text not null unique,            -- WhatsApp group id, e.g. 12036...@g.us
  name text not null,
  project_id uuid references projects(id) on delete set null,
  developer_id uuid references developers(id) on delete set null,
  active boolean not null default true,   -- false = ignore this group entirely
  last_message_at timestamptz,
  created_at timestamptz not null default now()
);

create table wa_messages (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references wa_groups(id) on delete cascade,
  wa_message_id text not null,
  sender_jid text,
  sender_name text,
  sent_at timestamptz not null,
  kind text not null default 'text' check (kind in ('text','image','document','video','audio','other')),
  body text,
  file_path text,                         -- object path in the wa-media storage bucket
  file_name text,
  mime text,
  processed_at timestamptz,
  process_error text,
  created_at timestamptz not null default now(),
  unique (group_id, wa_message_id)
);
create index wa_messages_unprocessed on wa_messages (created_at) where processed_at is null;
create index wa_messages_group_time on wa_messages (group_id, sent_at desc);

create table project_updates (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references projects(id) on delete cascade,
  group_id uuid references wa_groups(id) on delete set null,
  message_id uuid references wa_messages(id) on delete set null,
  kind text not null check (kind in ('inventory','price_change','offer','marketing_asset','construction','announcement','other')),
  title text not null,
  summary text,
  data jsonb not null default '{}'::jsonb, -- extracted fields: tower, unit, bhk, price, status, validity, etc.
  file_path text,
  confidence numeric check (confidence between 0 and 1),
  status text not null default 'pending' check (status in ('pending','approved','rejected','auto_published')),
  reviewed_by uuid references profiles(id),
  reviewed_at timestamptz,
  published_at timestamptz,
  created_at timestamptz not null default now()
);
create index project_updates_feed on project_updates (project_id, created_at desc) where status in ('approved','auto_published');
create index project_updates_queue on project_updates (created_at) where status = 'pending';

alter table wa_groups enable row level security;
alter table wa_messages enable row level security;
alter table project_updates enable row level security;

create policy wa_groups_admin on wa_groups for all to authenticated
  using (public.app_current_role() = 'admin') with check (public.app_current_role() = 'admin');
create policy wa_messages_admin on wa_messages for all to authenticated
  using (public.app_current_role() = 'admin') with check (public.app_current_role() = 'admin');
-- Everyone signed in can read published updates; only admins and managers see the queue and decide.
create policy project_updates_read on project_updates for select to authenticated
  using (status in ('approved','auto_published') or public.app_current_role() in ('admin','manager'));
create policy project_updates_write on project_updates for all to authenticated
  using (public.app_current_role() in ('admin','manager')) with check (public.app_current_role() in ('admin','manager'));

-- Private bucket for files builders share (price sheets, brochures, creatives).
insert into storage.buckets (id, name, public) values ('wa-media', 'wa-media', false) on conflict (id) do nothing;
