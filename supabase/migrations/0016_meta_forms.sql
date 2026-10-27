-- Relive CRM 0016: the lead forms on each connected Facebook Page, refreshed from Meta on demand, so the routing screen can
-- offer forms that have not produced a lead yet.
create table meta_forms (
  form_id text primary key,
  page_id text not null,
  page_name text,
  name text not null,
  status text,
  leads_count int,
  refreshed_at timestamptz not null default now()
);
alter table meta_forms enable row level security;
create policy meta_forms_admin on meta_forms for all to authenticated
  using (public.app_current_role() = 'admin') with check (public.app_current_role() = 'admin');
