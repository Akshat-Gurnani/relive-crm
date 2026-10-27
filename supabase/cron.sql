-- Run once on the Supabase project after the migrations (needs the pg_cron extension, enabled from the dashboard).
-- Every minute: pass on untouched leads, queue follow-up and task reminders.
-- Push delivery is done by the `push` edge function, scheduled the same way (see README).
select cron.schedule('relive-rotate-untouched', '* * * * *', $$select public.rotate_untouched()$$);
select cron.schedule('relive-queue-reminders', '* * * * *', $$select public.queue_reminders()$$);
