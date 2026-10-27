# Cratio workflow review and Relive CRM gap list (21 Oct 2026)

Read-only review in Chrome, signed in as the administrator. Nothing was saved, exported, imported or deleted. No customer names or numbers are recorded here.
Evidence tags: [Certain] seen directly, [Likely] strong inference, [Guessing] gap-filling.

## What the first map missed
The first map recorded menus, fields and counts. This pass followed how a lead is actually worked. The biggest findings:

1. [Certain] **Untouched leads rotate automatically.** One converted lead's history shows it passing through four agents at 30-minute intervals while still "New", until one agent touched it. That agent then moved it New, Yet To Talk, Follow-up, Warm, Converted in about a week. Relive CRM assigns once and never re-assigns.
2. [Certain] **The phone is the real CRM.** Mobile push notifications are all switched on: new lead assigned, lead re-assigned, activity reminder 15 and 30 minutes before, new activity, task re-assigned, next follow-up 15 minutes before. Calls are logged against the lead automatically (type, start time, duration, recording link). Saved views have separate column sets for web and mobile.
3. [Certain] **Attendance is in active use.** About 132 pages of GPS check-ins and check-outs (staff, time, address, latitude, longitude, in and out notes), latest entries mid-October. Maps shows each user's location trail by date.
4. [Certain] **Relive CRM has no way to add a lead by hand.** Cratio leads come from walk-ins, references and direct calls as well as forms (sources seen: Walk-in designation, Reference, Direct Lead, several "FBL" form sources, events).
5. [Certain] Tasks and Notes exist per lead but were empty on the leads checked. [Likely] Agents use Next Follow-up On plus mobile reminders, not tasks.

## Lead record in Cratio
- Header actions: Edit, Delete, Back, Send Email, previous and next record (for example 4 of 68 in the current view).
- Tabs: Leads (the form), Tasks (Add Task, Add Visit), Notes (Add Note), Calls (auto-logged), History.
- History keeps a snapshot row per change: assigned to, stage, source, lead ageing bucket, time taken in that stage, status, updated time.
- Edit form: Save and New, Save, Cancel. Required: Customer Name, Mobile, Product Category, Lead Source, Assigned To, Lead Priority.
- Product Category is multi-select (one lead tagged to several projects).
- Next Follow-up On has date plus hour, minute, second in IST, and a notes field.
- Create Task: notes, assignee, category, due date and time. Create Visit: notes, category, date and time (defaults to now).
- Send Email: templates with merge fields (customer name, assigned agent's name, phone and email), rich text, attachments, CC, BCC, reply-to.
- Footer: created, modified and last viewed time.

## Leads grid
- Add, Delete, Search, More Actions (Import, Export, Mass Edit).
- Advanced search: field, operator, value rows, match all or any, add and remove rows, Generate.
- Saved views: name, conditions, private or public, mobile template, WhatsApp segment, summary row, separate column lists and sort for web and mobile. Create, edit, delete and clone views.
- Lead ageing column colour-coded (0-2 days up to 10+ days).
- Global search box in the header.

## Other modules
- Activities (planner): task list with status filter (Open, Overdue, Closed), date, user multi-select; "Overdue by N days"; tick to complete; quick-add panel with notes, assignee, due date, category, related to.
- Dashboard: configurable tiles (Edit) that open the matching saved view; source pie, stage funnel, user bar chart; "More" drill-down; cached, manual refresh.
- Notifications settings: email to agent on new and re-assigned lead and new task (on); customer emails and Day 3, 5, 9 drip emails (off); mobile push (all on, listed above); web push (none configured).
- Templates: 11 email templates (site visit reminder, thank-you, newsletters and others) plus SMS templates.
- Users: 78, list defaults to inactive users; profile, reporting-to manager.
- Unused: Companies (two sample records), Assets (empty), WhatsApp module.

## Gap list against Relive CRM V1, by priority

### P0: agents cannot switch without these
1. Mobile app with click-to-call and automatic call logging against the lead (type, duration, recording). Decision needed, see below.
2. Push notifications: lead assigned or re-assigned, follow-up due in 15 minutes, task reminders.
3. Untouched-lead rotation: re-assign a lead nobody has acted on within N minutes (Cratio uses 30), keep the trail in history.
4. Add lead by hand (walk-in, reference, direct call) and full edit of every field, with Save and New.
5. Per-lead Calls tab and a Call History module.
6. Tasks: create, assign, due time, complete, overdue list (planner), linked to a lead. Notes tab.

### P1: needed within the first weeks
7. Import (CSV with column mapping and an import log), Export, Mass edit (stage, assignee, priority) and bulk delete for admins.
8. Advanced filter builder and saved views (private or public, chosen columns and sort), dashboard tiles that open views.
9. Admin-managed picklists: stages, sources, priority, budget bands, sizes, possession, location, lost reasons, task categories.
10. Missing fields: priority, visit status, alternate contact, company, designation, address, birthday, anniversary, spouse birthday.
11. Email composer with templates and merge fields; SMS templates; email to agent on assignment.
12. Previous and next record navigation, global search, time-in-stage and ageing in history.
13. User management in the app: invite, deactivate, role, reporting-to manager.

### P2: later
14. Attendance with GPS check-in and check-out (in active use, needs the mobile app).
15. Location trail map per user.
16. Report library (lead summary, source and stage, lost, visits, first response, call reports) and call analytics.
17. Drip email sequences (currently off in Cratio).

### Not needed
Companies, Assets, the WhatsApp module.

## The decision that blocks P0
Cratio's agents live in its Android app. A web app, however polished, does not log calls. Options:
- **A. Own Android app, installed on company phones outside the Play Store.** Reads the phone's call log and recordings, posts them to the CRM, handles push and attendance. [Likely] Google Play restricts call-log access to default dialer apps, which is why sideloading is the realistic route. Most control, most build effort.
- **B. Cloud telephony** (Exotel, MyOperator, Knowlarity and similar; Cratio already lists six). Calls go through a virtual number, the provider sends call events and recordings to the CRM by webhook. No call-log permission problem; per-minute cost; agents dial through the provider's app or a click-to-call button.
- **C. Installable web app (PWA) only.** Push notifications and click-to-call work, but calls must be logged by hand. Cheapest; adoption risk is high because agents lose automatic logging.
