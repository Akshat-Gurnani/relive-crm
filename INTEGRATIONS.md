# Relive CRM integrations: how they work and how to switch each one on

Everything is set up from **Admin → Integrations** (admins only). Four tabs: Connections, Forms and webhooks, Google Sheets, Activity.

**Lead source** means Relive's own code for where a lead came from, exactly as marked in Cratio: DFBL, SFBL, AFBL, BTFBL, HFBL, ADFBL, IIA LEAD, PNB LEAD, EBL, DXL, DHGL and so on. Each form or webhook is tagged with one lead source. The channel (Facebook, Google Ads, website...) is kept separately.

## How a lead travels

```
Facebook / Instagram ad form ─┐
Google Ads lead form ─────────┤                       ┌─ assigned round robin in the source's team
Google Form (Apps Script) ────┼─> CRM web address ─> one database function ─┼─ alert: bell + phone/browser push + email
Website / WordPress form ─────┤   (checks the secret)  (ingest_lead)        ├─ campaign, ad set, ad, form, lead source kept on the lead
LinkedIn via Zapier / Make ───┘                       └─ row written to the master sheet and the lead-source / project sheets
```

- **Every lead lands once.** Facebook's lead ID, Google's lead ID or your own `external_id` is remembered; a resend is ignored.
- **Nothing is lost.** Each delivery is saved first, then processed. If Facebook's lookup fails, it is retried automatically (up to 8 times over a few hours) and admins are alerted if it still fails.
- **Same person again** (same phone, same project): it becomes a re-enquiry on the existing lead, and the owner is told.
- **A form nobody mapped** still lands: unassigned, and admins (plus that team's leaders) are told at once.
- **A bad phone number** is kept as an enquiry; admins are told.
- **Forms and webhooks** decide project, team (round robin) and lead source. Matching order: Facebook/Google form ID, then Facebook Page, then the channel's catch-all.

## 1. Facebook and Instagram lead ads (instant)

Meta sends only an ID to our address; the CRM then reads the lead, with campaign, ad set, ad, form and placement (Facebook, Instagram, Messenger), using a Page access token.

**What Meta requires (owner, one time):**
1. **developers.facebook.com** → Create app → type *Business*, linked to Relive's Business Manager.
2. Add products **Webhooks** and **Marketing API**. App settings → Basic: copy the **App secret**.
3. Webhooks → *Page* → Subscribe to **leadgen** with:
   - Callback URL: `https://relive-crm.vercel.app/api/integrations/meta`
   - Verify token: any phrase; save the same phrase in Admin → Integrations → Connections.
4. Business settings → **System users** → add an admin system user, give it the Page(s) and ad account(s), generate a token with `leads_retrieval`, `pages_manage_metadata`, `pages_show_list`, `pages_read_engagement`, `ads_management` (or `ads_read`). Paste it as **System user token** in Connections. A per-Page token also works.
5. Connect each Page to the app: Graph API Explorer, `POST /{page-id}/subscribed_apps?subscribed_fields=leadgen` with the Page token (or the Page's Business integrations settings).
6. Business settings → **Leads access** (Leads Access Manager) → allow the app / CRM for each Page.
7. **App Review and Business Verification:** for leads from the public (not just people with a role on the app), Meta needs the app *Live* with `leads_retrieval` approved. Submit for review with a screen recording of the Integrations screen. Usually days, sometimes weeks.
8. Test with Meta's **Lead Ads Testing Tool** (developers.facebook.com/tools/lead-ads-testing): the lead should appear in the CRM within seconds; Admin → Integrations → Activity shows it.

**In the CRM:** one entry covers the whole Page. *Reliive Solutions Pvt Ltd Page (all forms)* (Page ID 488520604624962) is already set up, with priority High.
- It reads the **lead source code** (DFBL, SFBL, AFBL, BTFBL, HFBL…) and the **project** from each form's name, then from the campaign and ad set names. Relive already names forms "PROJECT - CODE - …", so new forms need no setup. Cratio needed one hand-made mapping per form (about 45).
- Projects can have aliases for short names in form names (e.g. "CPA" → Centre Point Ayodhya, "Purvanchal Atlantis" → Purvanchal Royal Atlantis).
- **Give every lead to** (optional): one intake person, the way Cratio sends every Facebook lead to Varsha first. Leave it empty for round robin in the team.
- Forms whose name has no code (e.g. "CPA - ANIMESH", "MAX HNI"): add an entry with that form's ID and pick the lead source by hand. Entries with form IDs always win over the Page-wide entry.
- Form answers fill budget, location, BHK, property type and timing on the lead when the question says what it is; all answers are also kept on the lead.
- Overseas numbers keep their country code (Cratio cut them to 10 digits under +91, which broke about 90% of HFBL leads).

**Running next to Cratio:** a Page can send leads to more than one app at once, so the CRM can receive the same Facebook leads as Cratio during the switch-over without anything being turned off in Cratio. Each lead lands once (Facebook's lead ID is remembered).

**Before Meta approves:** keep leads flowing with a connector (Zapier, Make or Pabbly: *Facebook Lead Ads → Webhook POST*) into a *Website / other webhook* entry. Send `external_id` = the Facebook lead ID and `campaign_name`, `adset_name`, `ad_name`, `form_name` so the attribution is kept. Switch to the direct connection once approved; resends are recognised by ID, so there is no double counting.

## 2. Google Ads lead forms (instant)

Google posts each lead straight to us with campaign, ad group and creative IDs.
1. Admin → Integrations → Connections: save a **webhook key** (a long random phrase).
2. Google Ads → Assets → Lead forms → open the form → *Lead delivery option* → *Webhook integration*:
   URL `https://relive-crm.vercel.app/api/integrations/google-ads`, key: the same phrase. Press **Send test data**: it shows up in Activity, marked as a test.
3. Forms and webhooks → add a *Google Ads* entry with the form ID (shown in Google Ads), project, team, lead source.

Google sends IDs, not names, for campaigns. The CRM shows the IDs; filter Leads by the campaign ID.

## 3. Google Forms (and any future form)

1. Forms and webhooks → add an entry, Channel *Google Forms*. Copy the **address and secret** shown once.
2. In the Google Form: ⋮ → **Script editor**, paste the script below, put in the address and secret, Save.
3. Triggers (clock icon) → Add trigger → `onFormSubmit`, *From form*, *On form submit*. Allow access.

```javascript
// Relive CRM: sends every response of this form to the CRM.
const CRM_URL = "https://relive-crm.vercel.app/api/leads/PASTE-SLUG-HERE";
const CRM_SECRET = "PASTE-SECRET-HERE";

function onFormSubmit(e) {
  const answers = {};
  e.response.getItemResponses().forEach((r) => {
    const v = r.getResponse();
    answers[r.getItem().getTitle()] = Array.isArray(v) ? v.join(", ") : String(v);
  });
  // Map your question titles to the CRM's fields (change the right-hand names to your questions).
  const pick = (...names) => names.map((n) => answers[n]).find((v) => v) || "";
  const body = Object.assign({}, answers, {
    contact: pick("Name", "Full name", "Your name"),
    mobile: pick("Phone", "Mobile", "Mobile number", "Phone number", "WhatsApp number"),
    email: pick("Email", "Email address") || e.response.getRespondentEmail(),
    city: pick("City"),
    external_id: e.response.getId(),
    form_name: FormApp.getActiveForm().getTitle(),
  });
  const res = UrlFetchApp.fetch(CRM_URL, {
    method: "post", contentType: "application/json", payload: JSON.stringify(body),
    headers: { "x-capture-secret": CRM_SECRET }, muteHttpExceptions: true,
  });
  if (res.getResponseCode() >= 300) throw new Error("CRM said " + res.getResponseCode() + ": " + res.getContentText());
}
```

Every question that is not name, phone, email or city is kept on the lead as a form answer.

## 4. LinkedIn lead gen forms

LinkedIn's own Lead Sync API needs a separate application to LinkedIn (Marketing Developer Platform, *Lead Sync API* product), which is slow to get for a single company. Use a connector instead, today:
- Zapier / Make → *LinkedIn Lead Gen Forms: New form response* → *Webhooks: POST* to a *LinkedIn* entry's address, header `x-capture-secret`, fields `contact`, `mobile`, `email`, `city`, `external_id` (LinkedIn response ID), `campaign_name`, `form_name`.

## 5. Website, WordPress, landing pages, portals, IVR

Any tool that can send a web request: add an entry under Forms and webhooks (Channel *Website* or *Other webhook*) and post to its address.
- Fields: `contact`, `mobile`, `email`, `city`, optional `external_id`, `campaign_name`, `adset_name`, `ad_name`, `form_name`, `utm_source`, `utm_campaign`. Anything else becomes a form answer.
- JSON or form data. Secret in header `x-capture-secret`, `Authorization: Bearer`, or `?key=`.
- Property portals (99acres, MagicBricks, Housing.com) and missed-call / IVR numbers (Exotel, Knowlarity, MyOperator) usually offer a webhook or email forwarding; point the webhook here, or use a connector for the email.

## 6. Google Sheets (live mirror)

1. Google Cloud console → new project → enable **Google Sheets API** → IAM → **Service account** → Keys → *Add key* → JSON.
2. Admin → Integrations → Connections → paste the whole JSON file. The service account's email is shown.
3. Share each spreadsheet with that email as **Editor**.
4. Google Sheets tab → *Connect a sheet*: link, tab name, and which leads: all (master), one lead source (e.g. a DFBL sheet), one project or one team. Existing leads are written straight away.

What it writes: Lead ID, created, name, phone, email, city, project, lead source, channel, campaign, ad set, ad, form, stage, temperature, priority, owner, next follow-up, last remark, when, calls, re-enquiries, lost reason, form answers, updated.
- A row is rewritten within a minute of any change: new lead, stage, remark or note, call, task, reassignment.
- Rows are matched by **Lead ID in column A**: sort, filter and add your own columns to the right (after column Y), but keep column A.
- Rows are never deleted. A lead-source sheet (e.g. DFBL) can be shared with whoever supplies those leads (view only).
- A sheet that is not shared shows a clear error on the Google Sheets tab and is retried.

## 7. Alerts: app first, then email

- **Bell:** every alert, always.
- **Phone app:** while open, alerts arrive instantly (live connection). While closed, the app checks about every 15 minutes in the background and shows new alerts as phone notifications. For *instant* alerts to a closed phone, link the app to Expo push (below).
- **Browser push:** Alerts page → *Turn on* in each browser.
- **Email:** sent through **Resend** (free up to 3,000 emails a month). resend.com → add domain `relivesolutions.com` → add the DNS records it shows (at your domain provider) → create an API key → paste it in Connections with the sender, e.g. `Relive CRM <crm@relivesolutions.com>`. Until the domain is verified Resend only delivers to your own address.
- Each person chooses on the **Alerts** page: push on or off, email on or off, which alerts by email (new lead given to me, lead waiting for assignment, re-enquiry, reminders...), and for admins and team leaders "every new lead in my company / team".

**Instant push to a closed phone (Android):** needs a free Expo account and a Firebase project.
`cd mobile && npx eas-cli@latest init` (links the app), create a Firebase project, download `google-services.json`, upload its FCM key with `npx eas-cli credentials`, rebuild with `npm run build:android:apk`. The app then registers itself and the server pushes instantly.

## Also worth connecting next

- **Conversions back to Meta and Google (closes the loop).** When a lead reaches Site visit done or Booked, send that event to Meta's Conversions API and Google's offline conversions, so the ad platforms learn which leads turn into buyers and find more like them. Usually the single biggest improvement in lead quality for real estate. The CRM already stores the Facebook lead ID and Google click ID needed for matching.
- **WhatsApp Business API** (Interakt, WATI, AiSensy or Meta directly): send the first-contact template automatically within a minute of a new lead, and capture click-to-WhatsApp ad leads.
- **Cloud telephony / IVR** (Exotel, Knowlarity, MyOperator): missed calls and IVR enquiries become leads through a webhook; recorded calls attach to the lead.
- **Calendar:** site visits as Google Calendar events for the agent and the customer.

## Where things live (for developers)

| Piece | File |
|---|---|
| Database: routing, ingest, alerts queue, sheets queue, secrets | `supabase/migrations/0005_integrations.sql`, tests `tests/integrations.sql` |
| Every-minute runner (pg_cron + pg_net) | `supabase/jobs.sql` |
| Facebook webhook | `web/app/api/integrations/meta/route.ts`, `web/lib/integrations/meta.ts` |
| Google Ads webhook | `web/app/api/integrations/google-ads/route.ts`, `web/lib/integrations/google-ads.ts` |
| Forms / website / connectors | `web/app/api/leads/[slug]/route.ts` |
| Queue and retries | `web/lib/integrations/inbound.ts` |
| Alerts (web push, Expo push, email) | `web/lib/jobs/notify.ts` |
| Google Sheets | `web/lib/jobs/sheets.ts` |
| Job runner | `web/app/api/jobs/run/route.ts` |
| Admin screen | `web/app/(app)/admin/integrations/` |
| Phone alerts | `mobile/src/lib/alerts.ts` |

Server settings (Vercel environment variables, or the Connections tab): `SUPABASE_SERVICE_ROLE_KEY`, `JOBS_SECRET`, `APP_URL`, `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, and optionally `META_APP_SECRET`, `META_VERIFY_TOKEN`, `META_ACCESS_TOKEN`, `GOOGLE_ADS_WEBHOOK_KEY`, `GOOGLE_SERVICE_ACCOUNT_JSON`, `RESEND_API_KEY`, `EMAIL_FROM`. A Vercel variable wins over the same setting saved in the Connections tab.
