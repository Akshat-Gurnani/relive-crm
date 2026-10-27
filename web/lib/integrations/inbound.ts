import "server-only";
import { service, logEvent } from "@/lib/server/service";
import { fetchLead, type LeadgenChange } from "./meta";
import { mapGoogleAdsLead, type GoogleAdsLead } from "./google-ads";
import type { NormalisedLead } from "./types";

type Result = { status: string; lead_id?: string | null; message?: string };

/** Routes a normalised lead to its endpoint (project, team, vendor) and saves it through ingest_lead(). */
export async function ingest(lead: NormalisedLead): Promise<Result> {
  const db = service();
  const { data: endpoint, error: re } = await db.rpc("route_endpoint", {
    p_provider: lead.provider, p_page_id: lead.page_id ?? null, p_form_id: lead.form_id ?? null,
  });
  if (re) throw new Error(`routing failed: ${re.message}`);
  const { page_id: _page, ...p } = lead;
  void _page;
  const { data, error } = await db.rpc("ingest_lead", { p_endpoint: endpoint ?? null, p: { ...p, raw: lead.raw ?? null } });
  if (error) throw new Error(`saving failed: ${error.message}`);
  const r = data as { status: string; lead_id?: string };
  return { status: r.status, lead_id: r.lead_id ?? null };
}

// The work for one queued delivery, by provider. Anything that throws is retried later.
async function processOne(provider: string, payload: unknown): Promise<Result> {
  if (provider === "meta") return ingest({ ...(await fetchLead(payload as LeadgenChange)), raw: payload });
  if (provider === "google_ads") return ingest({ ...mapGoogleAdsLead(payload as GoogleAdsLead), raw: { ...(payload as object), google_key: undefined } });
  throw new Error(`unknown provider ${provider}`);
}

/**
 * Records a delivery in inbound_queue (so it survives a crash), then processes it straight away.
 * A delivery Meta or Google sends twice is recognised by its ID and skipped.
 */
export async function receive(provider: string, externalId: string, payload: unknown): Promise<Result> {
  const db = service();
  const { data: row, error } = await db.from("inbound_queue")
    .upsert({ provider, external_id: externalId, payload }, { onConflict: "provider,external_id", ignoreDuplicates: true })
    .select("id").maybeSingle();
  if (error) throw new Error(`queue failed: ${error.message}`);
  if (!row) return { status: "duplicate" };
  return work(row.id as number, provider, payload, 0);
}

async function work(id: number, provider: string, payload: unknown, attempts: number): Promise<Result> {
  const db = service();
  try {
    const r = await processOne(provider, payload);
    await db.from("inbound_queue").update({ status: "done", attempts: attempts + 1, lead_id: r.lead_id ?? null, last_error: null }).eq("id", id);
    return r;
  } catch (e) {
    const msg = (e as Error).message;
    const n = attempts + 1;
    const giveUp = n >= 8;
    await db.from("inbound_queue").update({
      status: giveUp ? "failed" : "pending", attempts: n, last_error: msg.slice(0, 500),
      next_at: new Date(Date.now() + Math.min(60, n * n) * 60_000).toISOString(),
    }).eq("id", id);
    await logEvent({ provider, status: giveUp ? "failed" : "error", message: msg, external_id: (payload as { leadgen_id?: string; lead_id?: string })?.leadgen_id ?? (payload as { lead_id?: string })?.lead_id ?? null });
    if (giveUp) {
      const { data: admins } = await db.from("profiles").select("id").eq("role", "admin").eq("active", true);
      for (const a of admins ?? []) await db.from("notifications").insert({ user_id: a.id, kind: "integration_failed", title: `A ${provider === "meta" ? "Facebook" : provider} lead could not be saved`, body: msg.slice(0, 200) });
    }
    return { status: "error", message: msg };
  }
}

/** Job runner: retry deliveries that failed earlier and are due again. */
export async function retryInbound(limit = 25) {
  const db = service();
  const { data } = await db.from("inbound_queue").select("id,provider,payload,attempts")
    .eq("status", "pending").lte("next_at", new Date().toISOString()).order("next_at").limit(limit);
  let ok = 0, failed = 0;
  for (const r of data ?? []) {
    const res = await work(r.id as number, r.provider as string, r.payload, r.attempts as number);
    if (res.status === "error") failed++; else ok++;
  }
  return { retried: (data ?? []).length, ok, failed };
}
