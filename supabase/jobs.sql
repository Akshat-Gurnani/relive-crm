-- Run once on the Supabase project (already done on relive-crm-test as migration 0006_jobs_and_realtime).
-- Every minute the database calls the web app's job runner: retries failed webhook deliveries, sends push and
-- email alerts, rewrites Google Sheets rows. JOBS_SECRET must match the JOBS_SECRET environment variable on Vercel.
create extension if not exists pg_net;
insert into private.secrets(key, value) values
  ('jobs_url', 'https://<your-crm-domain>/api/jobs/run'),
  ('jobs_secret', '<same value as JOBS_SECRET on Vercel>')
on conflict (key) do update set value = excluded.value, updated_at = now();

create or replace function private.call_job_runner() returns bigint
language sql security definer set search_path = private, public as $$
  select net.http_post(
    url := (select value from private.secrets where key = 'jobs_url'),
    headers := jsonb_build_object('authorization', 'Bearer ' || (select value from private.secrets where key = 'jobs_secret'),
                                  'content-type', 'application/json'),
    body := '{}'::jsonb,
    timeout_milliseconds := 55000)
$$;
select cron.schedule('relive-job-runner', '* * * * *', $$select private.call_job_runner()$$);

-- The phone app listens for its own new alerts while open.
alter publication supabase_realtime add table public.notifications;
