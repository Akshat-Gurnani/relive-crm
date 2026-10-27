import { after } from "next/server";
import { createHash } from "node:crypto";
import { json, service } from "@/lib/server/service";
import { runJobs } from "@/lib/jobs/run";

export const dynamic = "force-dynamic";

// Any form or tool that can send a web request: Google Forms (Apps Script), the website, WordPress, Zapier / Make
// (for LinkedIn lead forms, portals and anything else), Pabbly, IVR or missed-call numbers.
//   POST https://<crm>/api/leads/<endpoint-slug>
//   Secret: header "x-capture-secret: <secret>", or "Authorization: Bearer <secret>", or "?key=<secret>".
//   Body: JSON or form data. Field names per endpoint (default: contact, mobile, email, city, category, date);
//   every other field is kept on the lead as a form answer. Optional: external_id (to ignore resends),
//   campaign_name / adset_name / ad_name / form_name, utm_source / utm_campaign.

async function payload(req: Request): Promise<Record<string, unknown>> {
  const type = req.headers.get("content-type") ?? "";
  if (type.includes("application/json")) return (await req.json()) as Record<string, unknown>;
  if (type.includes("form")) return Object.fromEntries([...(await req.formData()).entries()].map(([k, v]) => [k, String(v)]));
  const text = await req.text();
  try { return JSON.parse(text); } catch { return Object.fromEntries(new URLSearchParams(text)); }
}

export async function POST(req: Request, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params;
  const url = new URL(req.url);
  const secret = req.headers.get("x-capture-secret") ?? (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "") ?? "";
  const key = secret || url.searchParams.get("key") || "";
  if (!key) return json({ error: "missing secret" }, 401);
  let body: Record<string, unknown>;
  try { body = await payload(req); } catch { return json({ error: "body must be JSON or form data" }, 400); }
  // flatten: every value as text, arrays joined (Google Forms checkbox answers)
  const flat = Object.fromEntries(Object.entries(body).map(([k, v]) => [k, Array.isArray(v) ? v.join(", ") : v === null || v === undefined ? "" : String(v)]));
  const { data, error } = await service().rpc("capture_enquiry", {
    p_slug: slug, p_secret_hash: createHash("sha256").update(key).digest("hex"), p_payload: flat,
  });
  if (error) {
    if (error.code === "28000") return json({ error: "unauthorised" }, 401);
    return json({ error: "temporary failure" }, 500); // the sender retries; the 5-minute duplicate guard makes that safe
  }
  after(() => runJobs(["notify", "sheets"]));
  return json(data);
}
