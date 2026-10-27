-- Run once on the Supabase project: private bucket for call recordings uploaded by the Android app.
-- Files live at <agent user id>/<device call id>.<ext>; an agent can upload only into their own folder,
-- and anyone who can see the call's lead can play it through a signed URL created by the web app.
insert into storage.buckets (id, name, public) values ('call-recordings', 'call-recordings', false)
on conflict (id) do nothing;

create policy "agents upload own recordings" on storage.objects for insert to authenticated
  with check (bucket_id = 'call-recordings' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "staff read recordings of visible calls" on storage.objects for select to authenticated
  using (bucket_id = 'call-recordings' and exists (
    select 1 from public.calls c
     where c.recording_path = storage.objects.name
       and (c.agent_id = auth.uid() or (c.lead_id is not null and public.can_see_lead_id(c.lead_id)))));
