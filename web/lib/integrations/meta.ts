import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { setting } from "@/lib/server/service";
import type { NormalisedLead } from "./types";

// Facebook and Instagram lead ads.
// Meta calls our webhook with only IDs (leadgen_id, page_id, form_id, ad_id, adgroup_id). We then read the lead
// itself from the Graph API with the Page's access token, together with the campaign, ad set and ad names.
const GRAPH = () => (process.env.META_GRAPH_BASE ?? "https://graph.facebook.com/v23.0").replace(/\/+$/, "");

export type LeadgenChange = { leadgen_id: string; page_id?: string; form_id?: string; ad_id?: string; adgroup_id?: string; created_time?: number };

/** Meta signs every delivery with the app secret: X-Hub-Signature-256: sha256=<hmac of the raw body>. */
export function validSignature(raw: string, header: string | null, appSecret: string): boolean {
  if (!header?.startsWith("sha256=")) return false;
  const expected = Buffer.from(createHmac("sha256", appSecret).update(raw, "utf8").digest("hex"));
  const got = Buffer.from(header.slice(7));
  return expected.length === got.length && timingSafeEqual(expected, got);
}

/** All leadgen changes in one webhook delivery (Meta batches several entries together). */
export function leadgenChanges(body: unknown): LeadgenChange[] {
  const out: LeadgenChange[] = [];
  const b = body as { object?: string; entry?: { id?: string; changes?: { field?: string; value?: LeadgenChange }[] }[] };
  if (b?.object !== "page") return out;
  for (const e of b.entry ?? []) for (const c of e.changes ?? []) {
    if (c.field === "leadgen" && c.value?.leadgen_id) out.push({ ...c.value, page_id: c.value.page_id ?? e.id });
  }
  return out;
}

const PHONE = /^(phone_number|phone|mobile|mobile_number|contact_number|whatsapp_number)$/i;
const NAME = /^(full_name|name)$/i;

/** Meta's field_data [{ name, values: [...] }] into our shape: contact fields plus every other answer. */
export function mapFieldData(fields: { name: string; values?: string[] }[]): Pick<NormalisedLead, "name" | "phone" | "email" | "city" | "answers"> {
  const r: Pick<NormalisedLead, "name" | "phone" | "email" | "city" | "answers"> = { answers: {} };
  let first = "", last = "";
  for (const f of fields ?? []) {
    const v = (f.values ?? []).filter(Boolean).join(", ").trim();
    if (!v) continue;
    const k = f.name.trim();
    if (PHONE.test(k) && !r.phone) r.phone = v;
    else if (NAME.test(k) && !r.name) r.name = v;
    else if (/^first_name$/i.test(k)) first = v;
    else if (/^last_name$/i.test(k)) last = v;
    else if (/^(email|work_email)$/i.test(k) && !r.email) r.email = v;
    else if (/^city$/i.test(k) && !r.city) r.city = v;
    else r.answers![k.replace(/\?+$/, "")] = v;
  }
  if (!r.name && (first || last)) r.name = `${first} ${last}`.trim();
  return r;
}

async function graph<T>(path: string, token: string): Promise<T> {
  const res = await fetch(`${GRAPH()}/${path}${path.includes("?") ? "&" : "?"}access_token=${encodeURIComponent(token)}`, { cache: "no-store", signal: AbortSignal.timeout(10_000) });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Meta ${res.status}: ${(body as { error?: { message?: string } }).error?.message ?? "request failed"}`);
  return body as T;
}

const formNames = new Map<string, string>();

/** Reads the full lead from Meta. Needs a token for the Page: per Page, or one system-user token for all. */
export async function fetchLead(c: LeadgenChange): Promise<NormalisedLead> {
  const token = (c.page_id ? await setting("", `meta_page_token:${c.page_id}`) : null) ?? (await setting("META_ACCESS_TOKEN", "meta_access_token"));
  if (!token) throw new Error(`no Meta access token for page ${c.page_id ?? "?"}: add one under Admin, Integrations`);
  const lead = await graph<{
    id: string; created_time?: string; field_data?: { name: string; values?: string[] }[];
    ad_id?: string; ad_name?: string; adset_id?: string; adset_name?: string; campaign_id?: string; campaign_name?: string;
    form_id?: string; platform?: string; is_organic?: boolean;
  }>(`${c.leadgen_id}?fields=created_time,field_data,ad_id,ad_name,adset_id,adset_name,campaign_id,campaign_name,form_id,platform,is_organic`, token);
  const formId = lead.form_id ?? c.form_id;
  let formName = formId ? formNames.get(formId) : undefined;
  if (formId && !formName) {
    formName = await graph<{ name?: string }>(`${formId}?fields=name`, token).then((f) => f.name ?? "").catch(() => "");
    if (formName) formNames.set(formId, formName);
  }
  return {
    provider: "meta",
    external_id: lead.id ?? c.leadgen_id,
    ...mapFieldData(lead.field_data ?? []),
    received_at: lead.created_time ?? (c.created_time ? new Date(c.created_time * 1000).toISOString() : undefined),
    campaign_id: lead.campaign_id, campaign_name: lead.campaign_name,
    adset_id: lead.adset_id ?? c.adgroup_id, adset_name: lead.adset_name,
    ad_id: lead.ad_id ?? c.ad_id, ad_name: lead.ad_name,
    form_id: formId, form_name: formName || undefined,
    platform: lead.is_organic ? "organic" : lead.platform,
    page_id: c.page_id,
  };
}

/** Connects a Page to the app for lead ads (subscribed_apps, field leadgen) using the saved system user token.
 *  Returns a short status for the admin screen. The token is never returned or logged. */
export async function subscribePage(pageId: string): Promise<{ page: string; ok: boolean; detail: string }> {
  const sys = await setting("META_ACCESS_TOKEN", "meta_access_token");
  if (!sys) return { page: pageId, ok: false, detail: "no system user token saved" };
  try {
    // a Page token is derived from the system user token; the system user must have access to the Page
    const pg = await graph<{ access_token?: string; name?: string }>(`${pageId}?fields=name,access_token`, sys);
    if (!pg.access_token) return { page: pageId, ok: false, detail: "Meta gave no Page token (check the system user has this Page with Leads access)" };
    const res = await fetch(`${GRAPH()}/${pageId}/subscribed_apps`, {
      method: "POST", cache: "no-store", signal: AbortSignal.timeout(10_000),
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ subscribed_fields: "leadgen", access_token: pg.access_token }),
    });
    const body = await res.json().catch(() => ({})) as { success?: boolean; error?: { message?: string } };
    if (!res.ok || !body.success) return { page: pageId, ok: false, detail: `${pg.name ?? pageId}: ${body.error?.message ?? "Meta refused"}`.slice(0, 200) };
    return { page: pageId, ok: true, detail: `${pg.name ?? pageId}: connected` };
  } catch (e) {
    return { page: pageId, ok: false, detail: (e instanceof Error ? e.message : String(e)).slice(0, 200) };
  }
}

export type PageForm = { form_id: string; page_id: string; page_name: string; name: string; status: string | null; leads_count: number | null; created_on: string | null };

/** Every lead form on a Page, newest first, read from Meta with the Page's own token (taken from the system user token). */
export async function listPageForms(pageId: string): Promise<{ page: string; ok: boolean; detail: string; forms: PageForm[] }> {
  const sys = (await setting("", `meta_page_token:${pageId}`)) ?? (await setting("META_ACCESS_TOKEN", "meta_access_token"));
  if (!sys) return { page: pageId, ok: false, detail: "no Meta token saved", forms: [] };
  try {
    const pg = await graph<{ access_token?: string; name?: string }>(`${pageId}?fields=name,access_token`, sys);
    const token = pg.access_token ?? sys;
    const forms: PageForm[] = [];
    let path: string | null = `${pageId}/leadgen_forms?fields=id,name,status,leads_count,created_time&limit=100`;
    for (let i = 0; path && i < 10; i++) {
      const r: { data?: { id: string; name?: string; status?: string; leads_count?: number; created_time?: string }[]; paging?: { cursors?: { after?: string }; next?: string } } = await graph(path, token);
      for (const f of r.data ?? []) forms.push({ form_id: f.id, page_id: pageId, page_name: pg.name ?? pageId, name: f.name ?? f.id, status: f.status ?? null, leads_count: f.leads_count ?? null, created_on: f.created_time ?? null });
      path = r.paging?.next && r.paging.cursors?.after ? `${pageId}/leadgen_forms?fields=id,name,status,leads_count,created_time&limit=100&after=${encodeURIComponent(r.paging.cursors.after)}` : null;
    }
    return { page: pageId, ok: true, detail: `${pg.name ?? pageId}: ${forms.length} forms`, forms };
  } catch (e) { return { page: pageId, ok: false, detail: (e instanceof Error ? e.message : String(e)).slice(0, 200), forms: [] }; }
}

export type LiveAd = { ad_id: string; account_id: string; account_name: string; name: string; status: string | null; adset_id: string | null; adset_name: string | null; campaign_id: string | null; campaign_name: string | null; form_id: string | null };

// the lead form an ad sends people to sits somewhere inside its creative, depending on the ad format
function findFormId(x: unknown): string | null {
  if (!x || typeof x !== "object") return null;
  for (const [k, v] of Object.entries(x as Record<string, unknown>)) {
    if (k === "lead_gen_form_id" && (typeof v === "string" || typeof v === "number")) return String(v);
    const f = findFormId(v);
    if (f) return f;
  }
  return null;
}

/** Active ads in every ad account the system user can read. Needs the ads_read permission on the system user token. */
export async function listLiveAds(): Promise<{ ok: boolean; detail: string; ads: LiveAd[] }> {
  const token = await setting("META_ACCESS_TOKEN", "meta_access_token");
  if (!token) return { ok: false, detail: "no system user token saved", ads: [] };
  try {
    const accts = await graph<{ data?: { id: string; name?: string; account_status?: number }[] }>("me/adaccounts?fields=id,name,account_status&limit=100", token);
    const live = (accts.data ?? []).filter((a) => a.account_status === 1);
    if (!live.length) return { ok: false, detail: "the system user has no active ad accounts assigned (Business settings, System users, Add assets, Ad accounts)", ads: [] };
    const ads: LiveAd[] = [];
    const notes: string[] = [];
    for (const a of live) {
      let path: string | null = `${a.id}/ads?fields=id,name,effective_status,adset{id,name},campaign{id,name},creative{object_story_spec,asset_feed_spec}&effective_status=${encodeURIComponent('["ACTIVE"]')}&limit=50`;
      let n = 0;
      try {
        for (let i = 0; path && i < 12; i++) {
          const r: { data?: { id: string; name?: string; effective_status?: string; adset?: { id: string; name?: string }; campaign?: { id: string; name?: string }; creative?: unknown }[]; paging?: { next?: string; cursors?: { after?: string } } } = await graph(path, token);
          for (const d of r.data ?? []) {
            ads.push({ ad_id: d.id, account_id: a.id.replace(/^act_/, ""), account_name: a.name ?? a.id, name: d.name ?? d.id, status: d.effective_status ?? null,
              adset_id: d.adset?.id ?? null, adset_name: d.adset?.name ?? null, campaign_id: d.campaign?.id ?? null, campaign_name: d.campaign?.name ?? null, form_id: findFormId(d.creative) });
            n++;
          }
          path = r.paging?.next && r.paging.cursors?.after ? `${a.id}/ads?fields=id,name,effective_status,adset{id,name},campaign{id,name},creative{object_story_spec,asset_feed_spec}&effective_status=${encodeURIComponent('["ACTIVE"]')}&limit=50&after=${encodeURIComponent(r.paging.cursors.after)}` : null;
        }
        notes.push(`${a.name ?? a.id}: ${n}`);
      } catch (e) { notes.push(`${a.name ?? a.id}: ${(e instanceof Error ? e.message : String(e)).slice(0, 120)}`); }
    }
    return { ok: true, detail: notes.join("; "), ads };
  } catch (e) { return { ok: false, detail: (e instanceof Error ? e.message : String(e)).slice(0, 220), ads: [] }; }
}
