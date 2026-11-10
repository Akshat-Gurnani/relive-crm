-- Run once on the Supabase project after the migrations (needs the pg_cron extension, enabled from the dashboard).
-- Every minute: pass on untouched leads, queue follow-up and task reminders.
-- Push delivery is done by the `push` edge function, scheduled the same way (see README).
select cron.schedule('relive-rotate-untouched', '* * * * *', $$select public.rotate_untouched()$$);
select cron.schedule('relive-queue-reminders', '* * * * *', $$select public.queue_reminders()$$);

-- 0026 ad monitoring: Meta spend sync every 30 min (each campaign fetched every 6 h), urgent checks hourly, daily checks + digest at 10:15 IST.
select cron.schedule('relive-ad-monitor-sync',   '*/30 * * * *', $$select private.ad_monitor_sync()$$);
select cron.schedule('relive-ad-monitor-hourly', '7 * * * *',    $$select private.ad_monitor_check(false)$$);
select cron.schedule('relive-ad-monitor-daily',  '45 4 * * *',   $$select private.ad_monitor_check(true)$$);
