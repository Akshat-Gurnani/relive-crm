# Relive CRM: build status (21 Oct 2026)

Decision recorded: Android gets automatic call logging (option A, installed as an APK outside the Play Store); iPhone and the web use tap-to-call with an after-call form (option C). Apple does not let any app read calls on iPhone.

## Done
- Database: migrations 0001 to 0003, 143 automated checks across all roles.
- Web CRM: everything in the Cratio workflow review's P0 and P1 lists except email sending from the server, custom report builder and a column chooser.
- Untouched-lead rotation (default 30 minutes, working hours 9 am to 9 pm, stops after 5 moves, only leads newer than 24 hours), editable in Admin, Lead rules.
- Reminders: follow-ups 15 minutes before, tasks 30 minutes before, to the bell, web push and phone push.
- Phone app (Expo, Android and iPhone): Today queue, leads, lead page, tap to call, after-call form, WhatsApp templates, stage and follow-up, notes, tasks, attendance with GPS, push. Android reads the call log every time the app opens and in the background, and uploads the dialer's recordings to the live server.
- Cratio export can be imported as is (Leads, Import).

## Needs the owner
- A Supabase project (database, login, file storage, scheduled jobs) and a Vercel project for the web app.
- An Expo account (free) for phone push notifications and cloud builds.
- An Apple Developer account (USD 99 a year) to put the app on iPhones outside Expo Go.
- Cratio exports of leads, calls and activities before the subscription ends.

## Not built yet
- Sending email from the server (templates open the agent's own mail app today).
- Custom report builder; the dashboard and calls page cover the main numbers.
- Location trail map (Maps); attendance stores each check-in's location.
- WhatsApp Business API sending (WhatsApp opens on the phone with the message filled in).
