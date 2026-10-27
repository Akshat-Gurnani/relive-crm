# Relive CRM: product spec v0.1 (working name)

Purpose: replace Cratio with a CRM built for a real estate advisory and channel-sales firm. Single tenant (Relive Solutions). Optimised for: fast first call, no lost enquiries, clean data, team and project-level access, and feeding lead quality back to Meta and Google.

## Principles
1. One record per person (phone in E.164 form). Every enquiry is kept as an event, never rejected.
2. A lead is a person's interest in one project. A person can have several leads, one per project.
3. Raw source payloads are stored forever, so any mapping mistake can be replayed.
4. Access is enforced in the database (row-level security), not just hidden in the UI.
5. Pipeline stages, sources and lost reasons are data, not code.

## Roles
- admin: everything, including users, sources, rules, imports.
- manager: leads of their team, plus unassigned leads on their team's projects; can reassign.
- agent: only leads assigned to them; can update stage, log activity, schedule visits.
- marketing: no phone or email; sees source, campaign, project and outcome aggregates only.
- viewer: read-only dashboards, no personal data.

## Pipeline (default, editable)
New, Yet To Talk, Follow-up, Site Visit Scheduled, Site Visit Done, Negotiation, Booked (won), Lost.
Temperature (separate from stage): Hot, Warm, Cold. Lost requires a reason.
(Carried over from Cratio: New, Yet To Talk, Followup, Hot, Converted, Lost, Site visit D, Warm, Cold. Hot, Warm and Cold become temperature, not stages.)

## Modules
V1 (core):
- Capture: webhook endpoints per form/source, field mapping, phone normalisation, re-enquiry handling, auto-assign by round robin within a team.
- Leads: list, filters, saved views, lead detail with timeline, ageing, next follow-up.
- Follow-ups: task queue per agent, overdue first, one-click outcomes.
- Site visits: schedule, mark done, who accompanied.
- Projects: developers, projects, team access.
- Users, teams, roles, audit log.
- Dashboards: Funnel of Sales by source, project, agent; speed to first call; follow-up compliance.
- Import: Cratio exports (leads, calls, activities) with legacy-id mapping.
V2:
- Calls: telephony provider webhooks (click-to-call, log, recording in storage).
- Bookings and commission tracking.
- Meta Conversions API and Google Customer Match feeds from lead outcomes.
- Inventory and rate index (tower, floor, unit) for customer-facing rate lookup.
V3:
- WhatsApp Cloud API: templates, broadcasts, shared inbox.
- Attendance and field visit maps, if the team uses them.

## Stack
Next.js (App Router, TypeScript, Tailwind) on Vercel. Supabase: Postgres, Auth, Row Level Security, Storage (recordings), Edge Functions (capture, provider webhooks, outbound feeds).

## Open decisions (defaults in brackets)
- Telephony provider [to be chosen from quotes].
- New Supabase project [yes] vs reuse the Lead Ledger project.
- Final stage list and lost reasons [as above, confirm with sales team].
- Whether marketing may see masked phone numbers [no].
