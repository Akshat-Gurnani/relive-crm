import "server-only";
import { createSign } from "node:crypto";
import { service, setting, logEvent } from "@/lib/server/service";

// Google Sheets mirror. Every lead change (new lead, stage, remark, call, task, reassignment) puts the lead on
// sheet_queue in the database; this job takes the queue and rewrites each lead's row in every sheet it belongs to:
// the master sheet ("all"), and sheets for its vendor, source, project or team. Rows are found by the Lead ID in
// column A, so people can sort and filter the sheet freely; rows are only ever updated or added, never deleted.
//
// Access: a Google Cloud service account. Each spreadsheet is shared with the service account's email as Editor.

const SHEETS = () => (process.env.GOOGLE_SHEETS_BASE ?? "https://sheets.googleapis.com/v4").replace(/\/+$/, "");
const TOKEN_URL = () => process.env.GOOGLE_TOKEN_URL ?? "https://oauth2.googleapis.com/token";

export const SHEET_COLUMNS: [string, string][] = [
  ["lead_id", "Lead ID"], ["created", "Created"], ["name", "Name"], ["phone", "Phone"], ["email", "Email"], ["city", "City"],
  ["project", "Project"], ["source", "Lead source"], ["provider", "Channel"], ["campaign_name", "Campaign"],
  ["adset_name", "Ad set"], ["ad_name", "Ad"], ["form_name", "Form"], ["stage", "Stage"], ["temperature", "Temperature"],
  ["priority", "Priority"], ["assigned_to", "Assigned to"], ["next_followup", "Next follow-up"], ["last_remark", "Last remark"],
  ["last_remark_at", "Last remark at"], ["calls", "Calls"], ["reenquiries", "Re-enquiries"], ["lost_reason", "Lost reason"],
  ["form_answers", "Form answers"], ["updated", "Updated"],
];
const LAST_COL = String.fromCharCode(64 + SHEET_COLUMNS.length); // Y for 25 columns

type Row = Record<string, string | number | boolean | null> & { lead_id: string; vendor_id: string | null; source_id: string | null; project_id: string | null; team_id: string | null; is_test: boolean };
type Target = { id: string; name: string; spreadsheet_id: string; tab_name: string; scope: string; scope_id: string | null; include_tests: boolean };

type ServiceAccount = { client_email: string; private_key: string };
export async function serviceAccount(): Promise<ServiceAccount | null> {
  const raw = await setting("GOOGLE_SERVICE_ACCOUNT_JSON", "google_service_account_json");
  if (!raw) return null;
  try {
    const j = JSON.parse(raw) as ServiceAccount;
    return j.client_email && j.private_key ? { client_email: j.client_email, private_key: j.private_key.replace(/\\n/g, "\n") } : null;
  } catch { return null; }
}

let token: { value: string; until: number } | null = null;
async function accessToken(sa: ServiceAccount): Promise<string> {
  if (token && token.until > Date.now() + 60_000) return token.value;
  const now = Math.floor(Date.now() / 1000);
  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const unsigned = `${b64({ alg: "RS256", typ: "JWT" })}.${b64({ iss: sa.client_email, scope: "https://www.googleapis.com/auth/spreadsheets", aud: TOKEN_URL(), iat: now, exp: now + 3600 })}`;
  const sig = createSign("RSA-SHA256").update(unsigned).sign(sa.private_key).toString("base64url");
  const res = await fetch(TOKEN_URL(), {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${unsigned}.${sig}` }),
    signal: AbortSignal.timeout(10_000),
  });
  const j = (await res.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; error_description?: string };
  if (!res.ok || !j.access_token) throw new Error(`Google sign-in failed: ${j.error_description ?? res.status}`);
  token = { value: j.access_token, until: Date.now() + (j.expires_in ?? 3600) * 1000 };
  return token.value;
}

async function api<T>(tok: string, path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${SHEETS()}/${path}`, { ...init, headers: { authorization: `Bearer ${tok}`, "content-type": "application/json", ...(init?.headers ?? {}) }, signal: AbortSignal.timeout(15_000) });
  const j = (await res.json().catch(() => ({}))) as T & { error?: { message?: string; status?: string } };
  if (!res.ok) {
    const m = j.error?.message ?? `HTTP ${res.status}`;
    throw new Error(res.status === 403 ? `no access to the sheet: share it with the service account as Editor (${m})` : res.status === 404 ? `spreadsheet not found (${m})` : m);
  }
  return j;
}

const range = (tab: string, r: string) => encodeURIComponent(`'${tab.replace(/'/g, "''")}'!${r}`);

function belongs(t: Target, r: Row): boolean {
  if (r.is_test && !t.include_tests) return false;
  switch (t.scope) {
    case "all": return true;
    case "vendor": return r.vendor_id === t.scope_id;
    case "source": return r.source_id === t.scope_id;
    case "project": return r.project_id === t.scope_id;
    case "team": return r.team_id === t.scope_id;
    default: return false;
  }
}

const cells = (r: Row) => SHEET_COLUMNS.map(([k]) => (r[k] === null || r[k] === undefined ? "" : typeof r[k] === "number" ? r[k] : String(r[k])));

/** Updates one tab: existing rows in place (matched by Lead ID), new leads appended. Creates the tab and header if missing. */
async function writeTarget(tok: string, t: Target, rows: Row[]) {
  const id = encodeURIComponent(t.spreadsheet_id);
  let colA: string[] = [];
  try {
    const got = await api<{ values?: string[][] }>(tok, `spreadsheets/${id}/values/${range(t.tab_name, "A:A")}?majorDimension=COLUMNS`);
    colA = got.values?.[0] ?? [];
  } catch (e) {
    if (!/Unable to parse range/i.test((e as Error).message)) throw e;
    await api(tok, `spreadsheets/${id}:batchUpdate`, { method: "POST", body: JSON.stringify({ requests: [{ addSheet: { properties: { title: t.tab_name, gridProperties: { frozenRowCount: 1 } } } }] }) });
  }
  const data: { range: string; values: (string | number)[][] }[] = [];
  if (colA[0] !== "Lead ID") data.push({ range: `'${t.tab_name}'!A1:${LAST_COL}1`, values: [SHEET_COLUMNS.map(([, h]) => h)] });
  const at = new Map<string, number>();
  colA.forEach((v, i) => { if (i > 0 && v) at.set(v, i + 1); });
  const fresh: (string | number)[][] = [];
  for (const r of rows) {
    const n = at.get(r.lead_id);
    if (n) data.push({ range: `'${t.tab_name}'!A${n}:${LAST_COL}${n}`, values: [cells(r)] });
    else fresh.push(cells(r));
  }
  if (data.length) await api(tok, `spreadsheets/${id}/values:batchUpdate`, { method: "POST", body: JSON.stringify({ valueInputOption: "RAW", data }) });
  if (fresh.length) {
    const start = Math.max(colA.length, 1) + 1;
    await api(tok, `spreadsheets/${id}/values/${range(t.tab_name, `A${start}`)}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`, { method: "POST", body: JSON.stringify({ values: fresh }) });
  }
  return { updated: data.length - (colA[0] !== "Lead ID" ? 1 : 0), added: fresh.length };
}

export async function syncSheets(limit = 300) {
  const db = service();
  const { data: targets } = await db.from("sheet_targets").select("id,name,spreadsheet_id,tab_name,scope,scope_id,include_tests").eq("active", true);
  if (!targets?.length) return { skipped: "no sheets set up" };
  const sa = await serviceAccount();
  if (!sa) return { skipped: "Google service account not set" };
  const { data, error } = await db.rpc("sheet_claim", { p_limit: limit });
  if (error) throw new Error(`sheet claim failed: ${error.message}`);
  const rows = (Array.isArray(data) ? data : data ? [data] : []) as Row[];
  if (!rows.length) return { rows: 0 };
  const failed = new Set<string>();
  const out: Record<string, unknown> = { rows: rows.length };
  let tok: string;
  try { tok = await accessToken(sa); } catch (e) {
    await db.rpc("sheet_requeue", { p_leads: rows.map((r) => r.lead_id) });
    await db.from("sheet_targets").update({ last_error: (e as Error).message.slice(0, 300) }).eq("active", true);
    throw e;
  }
  for (const t of targets as Target[]) {
    const mine = rows.filter((r) => belongs(t, r));
    if (!mine.length) continue;
    try {
      const r = await writeTarget(tok, t, mine);
      out[t.name] = r;
      await db.from("sheet_targets").update({ last_synced_at: new Date().toISOString(), last_error: null }).eq("id", t.id);
    } catch (e) {
      const m = (e as Error).message;
      mine.forEach((r) => failed.add(r.lead_id));
      out[t.name] = { error: m };
      await db.from("sheet_targets").update({ last_error: m.slice(0, 300) }).eq("id", t.id);
      await logEvent({ provider: "google_sheets", direction: "out", status: "error", message: `${t.name}: ${m}` });
    }
  }
  if (failed.size) await db.rpc("sheet_requeue", { p_leads: [...failed] });
  return out;
}
