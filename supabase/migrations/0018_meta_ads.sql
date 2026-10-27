-- Relive CRM 0018: the live ads in the Meta ad accounts, with the lead form each one uses, refreshed on demand.
-- Lets lists be built from the ads that are running now instead of from old forms.
create table meta_ads (
  ad_id text primary key,
  account_id text not null,
  account_name text,
  name text not null,
  status text,
  adset_id text,
  adset_name text,
  campaign_id text,
  campaign_name text,
  form_id text,
  refreshed_at timestamptz not null default now()
);
create index meta_ads_form_idx on meta_ads(form_id);
alter table meta_ads enable row level security;
create policy meta_ads_admin on meta_ads for all to authenticated
  using (public.app_current_role() = 'admin') with check (public.app_current_role() = 'admin');
