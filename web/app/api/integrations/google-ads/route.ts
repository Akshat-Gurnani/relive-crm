import { after } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { json, setting, logEvent } from "@/lib/server/service";
import type { GoogleAdsLead } from "@/lib/integrations/google-ads";
import { receive } from "@/lib/integrations/inbound";
import { runJobs } from "@/lib/jobs/run";

export const dynamic = "force-dynamic";

// Google Ads lead form webhook.
//   In each lead form: "Lead delivery option" -> Webhook URL https://<crm>/api/integrations/google-ads, Key: the
//   value saved as GOOGLE_ADS_WEBHOOK_KEY (or under Admin, Integrations). Google expects 200 {} on success,
//   4xx (no retry) for a bad request and 5xx (retry) for a temporary failure.

const same = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

export async function POST(req: Request) {
  let p: GoogleAdsLead;
  try { p = (await req.json()) as GoogleAdsLead; } catch { return json({ message: "body must be JSON" }, 400); }
  const key = await setting("GOOGLE_ADS_WEBHOOK_KEY", "google_ads_webhook_key");
  if (!key) { await logEvent({ provider: "google_ads", status: "rejected", message: "webhook key not set" }); return json({ message: "not configured" }, 503); }
  if (!p.google_key || !same(String(p.google_key), key)) {
    await logEvent({ provider: "google_ads", status: "rejected", message: "wrong google_key", external_id: p.lead_id ?? null });
    return json({ message: "invalid key" }, 403);
  }
  if (!p.lead_id) return json({ message: "lead_id missing" }, 400);
  try {
    const r = await receive("google_ads", String(p.lead_id), { ...p, google_key: undefined });
    after(() => runJobs(["notify", "sheets"]));
    if (r.status === "error") return json({ message: "temporary failure" }, 500);
    return json({});
  } catch (e) {
    return json({ message: (e as Error).message }, 500);
  }
}
