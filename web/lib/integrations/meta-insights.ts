import "server-only";
import { service, setting } from "@/lib/server/service";

// Daily spend, impressions, clicks and Meta-counted leads per ad, from every ad account the system user can read.
// Stored in meta_ad_insights and joined to CRM leads by ad_id (see ads_report in the database).
const GRAPH = () => (process.env.META_GRAPH_BASE ?? "https://graph.facebook.com/v23.0").replace(/\/+$/, "");
const FIELDS = "ad_id,ad_name,adset_id,adset_name,campaign_id,campaign_name,account_id,account_name,account_currency,spend,impressions,clicks,actions,date_start";

type Insight = {
  ad_id: string; ad_name?: string; adset_id?: string; adset_name?: string; campaign_id?: string; campaign_name?: string;
  account_id?: string; account_name?: string; account_currency?: string; spend?: string; impressions?: string; clicks?: string;
  actions?: { action_type: string; value: string }[]; date_start: string;
};

async function get<T>(url: string): Promise<T> {
  const res = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(20_000) });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Meta ${res.status}: ${(body as { error?: { message?: string } }).error?.message ?? "request failed"}`);
  return body as T;
}

const istDate = (daysAgo: number) => new Date(Date.now() + 5.5 * 3600_000 - daysAgo * 86400_000).toISOString().slice(0, 10);
const metaLeads = (a: Insight["actions"]) => {
  const pick = (t: string) => Number(a?.find((x) => x.action_type === t)?.value ?? 0);
  return pick("lead") || pick("onsite_conversion.lead_grouped") || pick("leadgen_grouped");
};

/** Reads the last `days` days (today included) and upserts them. Safe to run repeatedly. */
export async function syncAdInsights(days = 30): Promise<{ ok: boolean; detail: string; rows: number }> {
  const token = await setting("META_ACCESS_TOKEN", "meta_access_token");
  if (!token) return { ok: false, detail: "no system user token saved", rows: 0 };
  const t = encodeURIComponent(token);
  const since = istDate(Math.max(1, days) - 1), until = istDate(0);
  const sb = service();
  let rows = 0;
  const notes: string[] = [];
  try {
    const accts = await get<{ data?: { id: string; name?: string; account_status?: number }[] }>(`${GRAPH()}/me/adaccounts?fields=id,name,account_status&limit=100&access_token=${t}`);
    const list = accts.data ?? [];
    if (!list.length) return { ok: false, detail: "the system user has no ad accounts assigned (Business settings, System users, Add assets, Ad accounts)", rows: 0 };
    for (const a of list) {
      let url: string | null = `${GRAPH()}/${a.id}/insights?level=ad&time_increment=1&limit=500&fields=${FIELDS}`
        + `&time_range=${encodeURIComponent(JSON.stringify({ since, until }))}&access_token=${t}`;
      let n = 0;
      try {
        for (let i = 0; url && i < 40; i++) {
          const r: { data?: Insight[]; paging?: { next?: string } } = await get(url);
          const batch = (r.data ?? []).filter((d) => d.ad_id).map((d) => ({
            day: d.date_start, ad_id: d.ad_id, account_id: (d.account_id ?? a.id).replace(/^act_/, ""), account_name: d.account_name ?? a.name ?? null,
            campaign_id: d.campaign_id ?? null, campaign_name: d.campaign_name ?? null, adset_id: d.adset_id ?? null, adset_name: d.adset_name ?? null,
            ad_name: d.ad_name ?? null, currency: d.account_currency ?? null, spend: Number(d.spend ?? 0), impressions: Number(d.impressions ?? 0),
            clicks: Number(d.clicks ?? 0), meta_leads: metaLeads(d.actions), refreshed_at: new Date().toISOString(),
          }));
          if (batch.length) {
            const { error } = await sb.from("meta_ad_insights").upsert(batch, { onConflict: "day,ad_id" });
            if (error) throw new Error(error.message);
            n += batch.length;
          }
          url = r.paging?.next ?? null;
        }
        rows += n;
        notes.push(`${a.name ?? a.id}: ${n}`);
      } catch (e) { notes.push(`${a.name ?? a.id}: ${(e instanceof Error ? e.message : String(e)).slice(0, 140)}`); }
    }
    await sb.from("app_settings").upsert({ key: "ads_sync", value: { last_at: new Date().toISOString(), days, rows, detail: notes.join("; ").slice(0, 900) }, updated_at: new Date().toISOString() }, { onConflict: "key" });
    return { ok: true, detail: notes.join("; "), rows };
  } catch (e) {
    return { ok: false, detail: (e instanceof Error ? e.message : String(e)).slice(0, 240), rows };
  }
}

/** Called by the job runner: refreshes the last 3 days at most every 6 hours (Meta revises recent days). */
export async function syncAdInsightsIfDue() {
  const sb = service();
  const { data } = await sb.from("app_settings").select("value").eq("key", "ads_sync").maybeSingle();
  const last = (data?.value as { last_at?: string } | undefined)?.last_at;
  if (last && Date.now() - new Date(last).getTime() < 6 * 3600_000) return { skipped: "fresh" };
  const token = await setting("META_ACCESS_TOKEN", "meta_access_token");
  if (!token) return { skipped: "no token" };
  return syncAdInsights(last ? 3 : 30);
}
