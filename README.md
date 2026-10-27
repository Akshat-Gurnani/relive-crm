# Relive CRM

Real estate CRM that replaces Cratio. See SPEC.md for scope and decisions.

## What exists
- `supabase/migrations/0001_core.sql`: schema, access rules (row level security), triggers, capture function.
- `supabase/migrations/0002_dashboard.sql`: `dashboard_stats(from, to)`, role-aware funnel numbers.
- `supabase/migrations/0003_workflows.sql`: the day-to-day workflows found in the Cratio review: adding leads by hand (`create_lead`, never duplicates), extra lead and contact fields, tasks, notes, owner history, untouched-lead rotation (`rotate_untouched`), follow-up and task reminders (`queue_reminders`), notifications and push subscriptions, call logging from phones and the web (`log_call`, `log_calls`, `attach_recording`), attendance and location, saved views, message templates, editable dropdown lists, CSV import (`import_leads`).
- `supabase/cron.sql` (scheduled jobs) and `supabase/storage.sql` (call recordings bucket): run once on the Supabase project.
- `web/`: Next.js app. Dashboard, follow-up queue, leads (filters, saved views, bulk edit, export, Cratio-compatible import, add lead), lead page (tabs for activity, tasks, notes, calls, site visits, enquiries, history; WhatsApp and email templates; previous and next), tasks planner, calls with top callers, attendance, notifications with web push, admin (staff, lead rules, lists, templates, capture). Installable on phones as an app (PWA).
- `mobile/`: Expo app for Android and iPhone. See `mobile/README.md`. Android logs calls by itself from the phone's call log.
- `tests/`: `./tests/run.sh` rebuilds a throwaway Postgres 16 database and runs 143 database checks across every role.

## Adding a lead form
1. Insert a row in `capture_endpoints` with a slug, project, source, team, and the SHA-256 hex of a secret you choose.
2. Point the form tool (Zapier, Pabbly, Meta) at `/functions/v1/capture/<slug>` with the header `x-capture-secret: <secret>`.
3. Adjust `field_map` if the form's field names differ from the default (contact, mobile, email, city, category, date).

## Run the web app locally
1. Apply both migrations and `seed.sql` to a Supabase project (SQL editor, or `supabase db push`).
2. Create staff in Supabase Auth (Dashboard > Authentication > Users), then add a matching row in `profiles` (id = the auth user id, full_name, role, team_id).
3. `cd web && cp .env.example .env.local`, fill the project URL and the publishable (anon) key, then `npm install && npm run dev`.
The app never holds the service role key. Only the capture edge function does.

## Deploy (not done yet)
Needs a Supabase project and a Vercel project. Apply the migration and seed, deploy the function, set `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`. Never commit keys.

## Try it on your Mac (no Docker, no cloud)
1. One time: `brew install postgresql@16` (Node 20+ also needed).
2. `cd local && sh start.sh` (add `--reset` to reload demo data, `--lan` to open it to phones on the same Wi-Fi). Opens http://localhost:3000.
3. Logins, password `demo1234`: admin@, manager.lko@, priya@ (agent), marketing@ — all `@relive.test`.
4. Fake a new enquiry: `./send-test-lead.sh` (run twice with the same number to see a re-enquiry).
Data lives in `~/.relive-crm-local`. This stack is for testing only; production uses Supabase.

## Design
- Visual language follows relivesolutions.com: night navy background (#0b0e14), coral primary (#f06043), navy secondary (#1d3369), Plus Jakarta Sans (bundled, works offline), pill buttons, glass surfaces, navy and coral glows, the company logo.
- Layout follows Frappe CRM's pattern (sidebar with emoji views, breadcrumb header, lead page with tabs and a details panel). No Frappe code was copied (AGPL).
- Summary strip on the lead page follows trycompai/crm (MIT). Icons are vector emoji from alohe/emojicloud (MIT, licence in `web/public/emoji`).
- Motion: page fade-in, staggered cards, growing bars, hover lift and press feedback. Off when the OS "reduce motion" setting is on.

## Deploying (Vercel)

- Vercel project root directory: `web`. Framework: Next.js. Every push to `main` deploys to production.
- Environment variables live in Vercel (Project, Settings, Environment Variables). Secrets such as the Meta, Gemini and Resend keys are stored in the database (Admin, Integrations), never in this repository.
- Database changes: add a numbered file under `supabase/migrations` and apply it to the Supabase project before merging the code that needs it.

Deployments from GitHub are live: a push to main builds the web app from the web folder on Vercel.
