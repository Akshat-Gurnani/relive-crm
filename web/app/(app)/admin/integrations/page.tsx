import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getStaff } from "@/lib/session";
import { getRefs } from "@/lib/refs";
import { one, dateTime } from "@/lib/format";
import { appUrl } from "@/lib/server/service";
import { aiConfig } from "@/lib/ai";
import { serviceAccount } from "@/lib/jobs/sheets";
import { Emoji, Empty, Notice, Page, PageHeader } from "@/components/ui";
import { rotateEndpointSecret, runNow, saveEndpoint, saveSecret, connectMetaPages, saveSheet, sheetAction, toggleEndpoint } from "./actions";

export const dynamic = "force-dynamic";

type Endpoint = { id: string; slug: string; name: string; active: boolean; provider: string; match_page_id: string | null; match_form_ids: string[]; is_default: boolean;
  project_id: string | null; team_id: string | null; source_id: string | null; vendor_id: string | null;
  assign_to: string | null; default_priority: string | null };
type Sheet = { id: string; name: string; spreadsheet_id: string; tab_name: string; scope: string; scope_id: string | null; include_tests: boolean; active: boolean; last_synced_at: string | null; last_error: string | null };
type Ev = { id: number; at: string; provider: string; direction: string; status: string; message: string | null; external_id: string | null; lead_id: string | null };

const CHANNEL: Record<string, string> = { meta: "Facebook / Instagram", google_ads: "Google Ads", google_forms: "Google Forms", linkedin: "LinkedIn", website: "Website", webhook: "Other webhook", other: "Other", google_sheets: "Google Sheets" };
const STATUS_TONE: Record<string, string> = { processed: "text-won", synced: "text-won", sent: "text-won", duplicate: "text-mute", unmapped: "text-warn", invalid_phone: "text-warn", error: "text-bad", failed: "text-bad", rejected: "text-bad" };

function Copy({ value }: { value: string }) {
  return <code className="block overflow-x-auto whitespace-nowrap rounded-lg bg-white/[.06] px-2.5 py-1.5 text-[12px]">{value}</code>;
}
function Dot({ ok, label }: { ok: boolean; label: string }) {
  return <span className={`inline-flex items-center gap-1.5 text-[12.5px] ${ok ? "text-won" : "text-mute"}`}><span className={`h-1.5 w-1.5 rounded-full ${ok ? "bg-won" : "bg-faint"}`} />{label}</span>;
}
function SecretForm({ k, label, placeholder, multiline, page }: { k: string; label: string; placeholder?: string; multiline?: boolean; page?: boolean }) {
  return (
    <form action={saveSecret} className="flex flex-wrap items-end gap-2">
      <input type="hidden" name="key" value={k} />
      {page && <div className="w-40"><label className="label">Page ID</label><input name="page_id" className="input h-9" placeholder="1234567890" /></div>}
      <div className="min-w-0 flex-1"><label className="label">{label}</label>
        {multiline ? <textarea name="value" rows={3} className="input font-mono text-[11.5px]" placeholder={placeholder} /> : <input name="value" type="password" autoComplete="off" className="input h-9" placeholder={placeholder} />}
      </div>
      <button className="btn-quiet h-9" type="submit">Save</button>
    </form>
  );
}

export default async function Integrations({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const { sb, profile } = await getStaff();
  // Top-level admins only. Team leaders and everyone else are sent back.
  if (profile.role !== "admin") redirect("/admin");
  const tab = one(sp.tab) ?? "connections";
  const refs = await getRefs();
  const [secretsRes, epRes, sheetsRes, evRes, queueRes] = await Promise.all([
    sb.rpc("integration_secret_status"),
    sb.from("capture_endpoints").select("id,slug,name,active,provider,match_page_id,match_form_ids,is_default,project_id,team_id,source_id,vendor_id,assign_to,default_priority").order("provider").order("name"),
    sb.from("sheet_targets").select("*").order("created_at"),
    sb.from("integration_events").select("id,at,provider,direction,status,message,external_id,lead_id").order("id", { ascending: false }).limit(80),
    sb.from("inbound_queue").select("id,provider,external_id,status,attempts,last_error,next_at").neq("status", "done").order("id", { ascending: false }).limit(30),
  ]);
  const secrets = new Map(((secretsRes.data ?? []) as { key: string; updated_at: string }[]).map((s) => [s.key, s.updated_at]));
  const ai = await aiConfig();
  const has = (env: string, key: string) => !!process.env[env] || secrets.has(key);
  const pageTokens = [...secrets.keys()].filter((k) => k.startsWith("meta_page_token:")).map((k) => k.split(":")[1]);
  const endpoints = (epRes.data ?? []) as Endpoint[];
  const sheets = (sheetsRes.data ?? []) as Sheet[];
  const events = (evRes.data ?? []) as Ev[];
  const pending = (queueRes.data ?? []) as { id: number; provider: string; external_id: string; status: string; attempts: number; last_error: string | null; next_at: string }[];
  const sa = await serviceAccount().catch(() => null);
  const base = appUrl();
  const name = (list: { id: string; name: string }[], id: string | null) => list.find((x) => x.id === id)?.name ?? "–";
  const projectList = refs.projects as { id: string; name: string }[];
  const teams = refs.teams as { id: string; name: string }[];
  const sources = refs.sources as { id: string; name: string }[];
  const staffList = (refs.staff as { id: string; full_name: string; active: boolean }[]).filter((s) => s.active).map((s) => ({ id: s.id, name: s.full_name }));
  let fresh: { slug: string; secret: string } | null = null;
  try { const c = (await cookies()).get("relive_new_secret")?.value; if (c) fresh = JSON.parse(c); } catch { /* none */ }
  const tabs: [string, string][] = [["connections", "Connections"], ["sources", "Forms and webhooks"], ["sheets", "Google Sheets"], ["log", "Activity"]];
  const errors24 = events.filter((e) => ["error", "failed", "rejected"].includes(e.status) && Date.now() - new Date(e.at).getTime() < 86_400_000).length;

  return (
    <>
      <PageHeader crumbs={[{ label: "Admin", href: "/admin" }, { label: "Integrations" }]}>
        {errors24 > 0 && <Link href="/admin/integrations?tab=log" className="text-[12.5px] text-bad">{errors24} problem{errors24 > 1 ? "s" : ""} in the last day</Link>}
      </PageHeader>
      <Page>
        <div className="flex flex-wrap gap-1.5">{tabs.map(([k, l]) => <Link key={k} href={`/admin/integrations?tab=${k}`} className="chip" aria-current={tab === k ? "true" : undefined}>{l}</Link>)}</div>
        {one(sp.error) && <Notice>{one(sp.error)}</Notice>}
        {one(sp.notice) && <Notice tone="ok">{one(sp.notice)}</Notice>}

        {tab === "connections" && <div className="grid gap-4 xl:grid-cols-2">
          <section className="panel p-5 space-y-3">
            <h2 className="panel-title flex items-center gap-2"><Emoji name="zap" size={15} />Facebook and Instagram lead ads</h2>
            <div className="flex flex-wrap gap-3">
              <Dot ok={has("META_APP_SECRET", "meta_app_secret")} label="App secret" />
              <Dot ok={has("META_VERIFY_TOKEN", "meta_verify_token")} label="Verify token" />
              <Dot ok={has("META_ACCESS_TOKEN", "meta_access_token") || pageTokens.length > 0} label={pageTokens.length ? `Page tokens: ${pageTokens.join(", ")}` : "Access token"} />
            </div>
            <p className="text-[12.5px] text-mute">In your Meta app: Webhooks, Page, subscribe to <b>leadgen</b> with this callback URL and your verify token. Then connect each Page to the app. Leads arrive within seconds of the form being sent.</p>
            <Copy value={`${base}/api/integrations/meta`} />
            <SecretForm k="meta_app_secret" label="App secret (App settings, Basic)" />
            <SecretForm k="meta_verify_token" label="Verify token (any phrase you choose, also typed into Meta)" />
            <SecretForm k="meta_access_token" label="System user token (one token for all Pages), or add per-Page tokens below" />
            <SecretForm k="meta_page_token" page label="Page access token" />
            <form action={connectMetaPages} className="pt-1">
              <button className="btn-quiet h-9" type="submit">Connect Pages to the app</button>
              <p className="text-[12px] text-mute mt-1">Uses the saved system user token to connect every Page listed under Forms and webhooks. Safe to press again after adding a Page.</p>
            </form>
          </section>

          <section className="panel p-5 space-y-3">
            <h2 className="panel-title flex items-center gap-2"><Emoji name="sparkles" size={15} />Google Ads lead forms</h2>
            <Dot ok={has("GOOGLE_ADS_WEBHOOK_KEY", "google_ads_webhook_key")} label="Webhook key" />
            <p className="text-[12.5px] text-mute">In each lead form asset: Lead delivery, Webhook integration. Paste this URL and the same key, then press &quot;Send test data&quot;. Map the form under Forms and webhooks by its form ID.</p>
            <Copy value={`${base}/api/integrations/google-ads`} />
            <SecretForm k="google_ads_webhook_key" label="Webhook key (choose a long random phrase)" />
          </section>

          <section className="panel p-5 space-y-3">
            <h2 className="panel-title flex items-center gap-2"><Emoji name="writing" size={15} />Google Sheets</h2>
            <Dot ok={!!sa} label={sa ? `Service account: ${sa.client_email}` : "Service account not set"} />
            <p className="text-[12.5px] text-mute">Create a service account in Google Cloud (Sheets API on), make a JSON key, paste it here. Share every spreadsheet with the service account&apos;s email as Editor.</p>
            {sa && <Copy value={sa.client_email} />}
            <SecretForm k="google_service_account_json" multiline label="Service account key (JSON)" placeholder='{"type":"service_account", ...}' />
          </section>

          <section className="panel p-5 space-y-3">
            <h2 className="panel-title flex items-center gap-2"><Emoji name="envelope" size={15} />Email alerts</h2>
            <div className="flex flex-wrap gap-3">
              <Dot ok={has("RESEND_API_KEY", "resend_api_key")} label="Email service key" />
              <Dot ok={has("EMAIL_FROM", "email_from")} label="Sender address" />
              <Dot ok={!!process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY && !!process.env.VAPID_PRIVATE_KEY} label="Browser push" />
              <Dot ok={!!process.env.JOBS_SECRET} label="Every-minute runner" />
            </div>
            <p className="text-[12.5px] text-mute">Emails go through Resend (free for 3,000 a month). Verify relivesolutions.com there first so alerts come from your own domain, e.g. <i>Relive CRM &lt;crm@relivesolutions.com&gt;</i>. Each person picks which alerts they want by email under Alerts.</p>
            <SecretForm k="resend_api_key" label="Resend API key" placeholder="re_..." />
            <form action={saveSecret} className="flex items-end gap-2"><input type="hidden" name="key" value="email_from" />
              <div className="flex-1"><label className="label">Sender</label><input name="value" className="input h-9" placeholder="Relive CRM <crm@relivesolutions.com>" /></div>
              <button className="btn-quiet h-9" type="submit">Save</button></form>
          </section>

          <section className="panel p-5 space-y-3">
            <h2 className="panel-title flex items-center gap-2"><Emoji name="crystal" size={15} />AI Insights (admins only)</h2>
            <div className="flex flex-wrap gap-3">
              <Dot ok={ai.gemini.length > 0} label={`Gemini keys: ${ai.gemini.length}`} />
              <Dot ok={ai.openrouter.length > 0} label={`OpenRouter keys: ${ai.openrouter.length}`} />
              <Dot ok={has("AI_MODEL", "ai_model")} label="Model chosen (optional)" />
            </div>
            <p className="text-[12.5px] text-mute">Used only on <Link className="underline" href="/admin/insights">AI Insights</Link>. Gemini is used if both keys are set. The AI only ever receives counts and rates from your own leads, never names, numbers, emails or remarks. Use a key from a Google Cloud project <b>with billing turned on</b>: on free keys Google may use what is sent to improve its models.</p>
            <p className="text-[12.5px] text-mute"><b>No downtime from one key:</b> paste all your keys at once, separated by commas. Each question tries them in turn and skips any key that is out of quota or failing, then falls back to OpenRouter. Saving replaces the keys stored before.</p>
            <SecretForm k="gemini_api_key" label="Gemini API keys (Google AI Studio), separated by commas" placeholder="AIza..., AIza..., AIza..." />
            <SecretForm k="openrouter_api_key" label="OpenRouter API keys, separated by commas (backup)" placeholder="sk-or-..., sk-or-..." />
            <form action={saveSecret} className="flex items-end gap-2"><input type="hidden" name="key" value="ai_model" />
              <div className="flex-1"><label className="label">Model (leave empty for gemini-flash-latest, or google/gemini-3.6-flash on OpenRouter)</label><input name="value" className="input h-9" placeholder="gemini-flash-latest" /></div>
              <button className="btn-quiet h-9" type="submit">Save</button></form>
          </section>
        </div>}

        {tab === "sources" && <>
          {fresh && (
            <Notice tone="warn">
              <div className="space-y-1.5"><b>Copy this now; it will not be shown again.</b>
                <div className="text-[12.5px]">Address for forms, Zapier, Make or Apps Script:</div><Copy value={`${base}/api/leads/${fresh.slug}`} />
                <div className="text-[12.5px]">Secret (send as header <code>x-capture-secret</code>, or add <code>?key=</code> to the address):</div><Copy value={fresh.secret} />
              </div>
            </Notice>
          )}
          <section className="panel overflow-x-auto">
            <div className="panel-head"><h2 className="panel-title flex items-center gap-2"><Emoji name="mailbox" size={15} />Forms and webhooks</h2><span className="text-[12px] text-mute">Each decides the project, team (round robin) and lead source of its leads</span></div>
            <table className="w-full">
              <thead><tr><th className="th">Name</th><th className="th">Channel</th><th className="th">Matches</th><th className="th">Project</th><th className="th">Team</th><th className="th">Lead source</th><th className="th">Status</th><th className="th" /></tr></thead>
              <tbody>
                {endpoints.length === 0 && <tr><td className="td text-mute" colSpan={8}>No forms or webhooks yet. Add one below.</td></tr>}
                {endpoints.map((e) => (
                  <tr key={e.id} className="row align-top">
                    <td className="td font-medium">{e.name}<div className="text-[11.5px] text-mute">{["meta", "google_ads"].includes(e.provider) ? "" : `/api/leads/${e.slug}`}</div></td>
                    <td className="td">{CHANNEL[e.provider] ?? e.provider}</td>
                    <td className="td text-[12.5px]">{e.is_default ? <span className="text-warn">Catch-all for this channel</span> : <>{e.match_page_id && <div>Page {e.match_page_id}</div>}{e.match_form_ids.length > 0 && <div>Forms {e.match_form_ids.join(", ")}</div>}{!e.match_page_id && !e.match_form_ids.length && <span className="text-mute">Own address</span>}</>}</td>
                    <td className="td">{name(projectList, e.project_id)}</td><td className="td">{name(teams, e.team_id)}</td><td className="td">{["meta", "google_ads"].includes(e.provider) && e.match_form_ids.length === 0 ? <span>From form name{e.source_id ? <span className="text-mute">, else {name(sources, e.source_id)}</span> : ""}</span> : name(sources, e.source_id)}
                      {(e.assign_to || e.default_priority) && <div className="text-[11.5px] text-mute">{[e.assign_to ? `to ${name(staffList, e.assign_to)}` : null, e.default_priority ? `${e.default_priority} priority` : null].filter(Boolean).join(" · ")}</div>}</td>
                    <td className="td"><form action={toggleEndpoint}><input type="hidden" name="id" value={e.id} /><input type="hidden" name="active" value={String(!e.active)} /><button className="btn-ghost h-7 text-[12px]" type="submit"><Dot ok={e.active} label={e.active ? "On" : "Off"} /></button></form></td>
                    <td className="td whitespace-nowrap">
                      <details><summary className="btn-ghost h-7 cursor-pointer list-none text-[12px]">Edit</summary>
                        <div className="mt-2 w-[22rem]"><EndpointForm e={e} projects={projectList} teams={teams}  sources={sources} staff={staffList} /></div>
                        {!["meta", "google_ads"].includes(e.provider) && <form action={rotateEndpointSecret} className="mt-2"><input type="hidden" name="id" value={e.id} /><button className="btn-ghost h-7 text-[12px]" type="submit">New secret</button></form>}
                      </details>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
          <div className="grid gap-4">
            <section className="panel p-5"><h2 className="panel-title mb-3">Add a form or webhook</h2><EndpointForm projects={projectList} teams={teams}  sources={sources} staff={staffList} /></section>
          </div>
        </>}

        {tab === "sheets" && <>
          {!sa && <Notice tone="warn">Add the Google service account under Connections first; sheets cannot be written without it.</Notice>}
          <section className="panel overflow-x-auto">
            <div className="panel-head"><h2 className="panel-title flex items-center gap-2"><Emoji name="writing" size={15} />Connected sheets</h2><span className="text-[12px] text-mute">Rewritten within a minute of every new lead, stage change, remark, call or reassignment</span></div>
            <table className="w-full">
              <thead><tr><th className="th">Name</th><th className="th">Which leads</th><th className="th">Tab</th><th className="th">Last written</th><th className="th">Status</th><th className="th" /></tr></thead>
              <tbody>
                {sheets.length === 0 && <tr><td className="td text-mute" colSpan={6}>No sheets yet. Start with a master sheet of all leads.</td></tr>}
                {sheets.map((s) => (
                  <tr key={s.id} className="row align-top">
                    <td className="td font-medium"><a className="hover:underline" href={`https://docs.google.com/spreadsheets/d/${s.spreadsheet_id}`} target="_blank" rel="noreferrer">{s.name} ↗</a></td>
                    <td className="td">{s.scope === "all" ? "All leads (master)" : `${s.scope[0].toUpperCase()}${s.scope.slice(1)}: ${name(s.scope === "project" ? projectList : s.scope === "team" ? teams : sources, s.scope_id)}`}{s.include_tests && <span className="text-mute"> · with test leads</span>}</td>
                    <td className="td">{s.tab_name}</td>
                    <td className="td text-[12.5px]">{s.last_synced_at ? dateTime(s.last_synced_at) : "–"}</td>
                    <td className="td text-[12.5px]">{!s.active ? <span className="text-mute">Paused</span> : s.last_error ? <span className="text-bad">{s.last_error}</span> : <span className="text-won">OK</span>}</td>
                    <td className="td whitespace-nowrap"><form action={sheetAction} className="flex gap-1"><input type="hidden" name="id" value={s.id} />
                      <button name="what" value="resync" className="btn-ghost h-7 text-[12px]" type="submit">Rewrite all</button>
                      <button name="what" value={s.active ? "pause" : "resume"} className="btn-ghost h-7 text-[12px]" type="submit">{s.active ? "Pause" : "Resume"}</button>
                      <button name="what" value="remove" className="btn-ghost h-7 text-[12px] text-bad" type="submit">Disconnect</button></form></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
          <section className="panel p-5">
            <h2 className="panel-title mb-1">Connect a sheet</h2>
            <p className="mb-3 text-[12.5px] text-mute">Share the spreadsheet with {sa ? <b>{sa.client_email}</b> : "the service account"} as Editor first. The CRM writes a header row and one row per lead, matched by Lead ID in column A: sort and filter freely, but keep column A.</p>
            <form action={saveSheet} className="grid gap-3 md:grid-cols-2">
              <div className="md:col-span-2"><label className="label">Spreadsheet link</label><input name="spreadsheet" className="input" placeholder="https://docs.google.com/spreadsheets/d/..." required /></div>
              <div><label className="label">Name in the CRM</label><input name="name" className="input" placeholder="Master sheet" /></div>
              <div><label className="label">Tab (created if missing)</label><input name="tab_name" className="input" defaultValue="Leads" /></div>
              <div><label className="label">Which leads</label>
                <select name="scope" className="input" defaultValue="all"><option value="all">All leads (master)</option><option value="source">One lead source</option><option value="project">One project</option><option value="team">One team</option></select></div>
              <div className="grid grid-cols-2 gap-2">
                <select name="scope_source" className="input" aria-label="Lead source"><option value="">Lead source…</option>{sources.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}</select>
                <select name="scope_project" className="input" aria-label="Project"><option value="">Project…</option>{projectList.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}</select>
                <select name="scope_team" className="input" aria-label="Team"><option value="">Team…</option>{teams.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}</select>
              </div>
              <label className="flex items-center gap-2 text-[13px]"><input type="checkbox" name="include_tests" /> Include test leads</label>
              <div className="md:col-span-2"><button className="btn" type="submit">Connect and write existing leads</button></div>
            </form>
          </section>
        </>}

        {tab === "log" && <>
          <div className="flex items-center justify-between"><p className="text-[12.5px] text-mute">Every lead received and every sheet or email problem. Runs by itself every minute; you can also run it now.</p>
            <form action={runNow}><button className="btn-quiet h-8" type="submit">Run now</button></form></div>
          {pending.length > 0 && (
            <section className="panel overflow-x-auto">
              <div className="panel-head"><h2 className="panel-title">Waiting to retry</h2></div>
              <table className="w-full"><tbody>{pending.map((p) => (
                <tr key={p.id} className="row"><td className="td">{CHANNEL[p.provider] ?? p.provider}</td><td className="td text-[12px]">{p.external_id}</td><td className={`td ${p.status === "failed" ? "text-bad" : "text-warn"}`}>{p.status === "failed" ? "Gave up" : `Try ${p.attempts + 1} at ${dateTime(p.next_at)}`}</td><td className="td text-[12.5px] text-mute">{p.last_error}</td></tr>
              ))}</tbody></table>
            </section>
          )}
          <section className="panel overflow-x-auto">
            {events.length === 0 ? <Empty emoji="mailbox">Nothing received yet.</Empty> : (
              <table className="w-full">
                <thead><tr><th className="th">When</th><th className="th">Channel</th><th className="th">Result</th><th className="th">Details</th><th className="th">Lead</th></tr></thead>
                <tbody>{events.map((e) => (
                  <tr key={e.id} className="row"><td className="td whitespace-nowrap text-[12.5px]">{dateTime(e.at)}</td><td className="td">{CHANNEL[e.provider] ?? e.provider}</td>
                    <td className={`td ${STATUS_TONE[e.status] ?? ""}`}>{e.status.replace("_", " ")}</td><td className="td text-[12.5px] text-mute">{e.message}</td>
                    <td className="td">{e.lead_id ? <Link className="text-accent-2 hover:underline" href={`/leads/${e.lead_id}`}>Open</Link> : "–"}</td></tr>
                ))}</tbody>
              </table>
            )}
          </section>
        </>}
      </Page>
    </>
  );
}

function EndpointForm({ e, projects, teams, sources, staff }: { e?: Endpoint; projects: { id: string; name: string }[]; teams: { id: string; name: string }[]; sources: { id: string; name: string }[]; staff: { id: string; name: string }[] }) {
  const sel = (n: string, label: string, list: { id: string; name: string }[], v: string | null | undefined) => (
    <div><label className="label">{label}</label><select name={n} defaultValue={v ?? ""} className="input"><option value="">–</option>{list.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></div>
  );
  return (
    <form action={saveEndpoint} className="grid gap-3 sm:grid-cols-2">
      {e && <input type="hidden" name="id" value={e.id} />}
      <div className="sm:col-span-2"><label className="label">Name</label><input name="name" defaultValue={e?.name ?? ""} className="input" placeholder="Migsun Facebook studio form" required /></div>
      <div><label className="label">Channel</label><select name="provider" defaultValue={e?.provider ?? "meta"} className="input">{Object.entries(CHANNEL).filter(([k]) => k !== "google_sheets").map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
      {sel("project_id", "Project", projects, e?.project_id)}
      {sel("team_id", "Team (round robin)", teams, e?.team_id)}
      {sel("source_id", "Lead source (e.g. DFBL)", sources, e?.source_id)}
      {sel("assign_to", "Give every lead to (optional; else round robin)", staff, e?.assign_to)}
      <div><label className="label">Priority for new leads</label><select name="default_priority" defaultValue={e?.default_priority ?? ""} className="input"><option value="">Medium (default)</option><option>High</option><option>Low</option></select></div>
      <p className="text-[12px] text-mute sm:col-span-2">Facebook and Google entries without form IDs read the lead source code (DFBL, SFBL, HFBL…) and the project from each form&apos;s name, so new forms need no setup. Add form IDs only to override that for particular forms.</p>
      <div><label className="label">Facebook Page ID</label><input name="match_page_id" defaultValue={e?.match_page_id ?? ""} className="input" placeholder="Facebook only" /></div>
      <div className="sm:col-span-2"><label className="label">Form IDs (Facebook or Google Ads, comma separated)</label><input name="match_form_ids" defaultValue={e?.match_form_ids.join(", ") ?? ""} className="input" placeholder="e.g. 1234567890123456" /></div>
      <label className="flex items-center gap-2 text-[13px] sm:col-span-2"><input type="checkbox" name="is_default" defaultChecked={e?.is_default} /> Catch-all: receives this channel&apos;s leads from forms not mapped anywhere else</label>
      <div className="sm:col-span-2"><button className="btn" type="submit">{e ? "Save" : "Add lead source"}</button></div>
    </form>
  );
}
