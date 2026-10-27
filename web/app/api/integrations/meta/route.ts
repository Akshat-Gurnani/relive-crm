import { after } from "next/server";
import { json, setting, logEvent } from "@/lib/server/service";
import { leadgenChanges, validSignature } from "@/lib/integrations/meta";
import { receive } from "@/lib/integrations/inbound";
import { runJobs } from "@/lib/jobs/run";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Facebook / Instagram lead ads webhook.
//   Callback URL in the Meta app (Webhooks, Page, field "leadgen"): https://<crm>/api/integrations/meta
//   Verify token: the value saved as META_VERIFY_TOKEN (or under Admin, Integrations).

export async function GET(req: Request) {
  const u = new URL(req.url).searchParams;
  const expected = await setting("META_VERIFY_TOKEN", "meta_verify_token");
  if (u.get("hub.mode") === "subscribe" && expected && u.get("hub.verify_token") === expected) {
    return new Response(u.get("hub.challenge") ?? "", { status: 200, headers: { "content-type": "text/plain" } });
  }
  return json({ error: "verification failed" }, 403);
}

export async function POST(req: Request) {
  const raw = await req.text();
  const appSecret = await setting("META_APP_SECRET", "meta_app_secret");
  if (!appSecret) {
    await logEvent({ provider: "meta", status: "rejected", message: "META_APP_SECRET is not set, delivery ignored" });
    return json({ error: "not configured" }, 503);
  }
  if (!validSignature(raw, req.headers.get("x-hub-signature-256"), appSecret)) {
    await logEvent({ provider: "meta", status: "rejected", message: "bad signature" });
    return json({ error: "bad signature" }, 401);
  }
  let body: unknown;
  try { body = JSON.parse(raw); } catch { return json({ error: "bad json" }, 400); }
  const changes = leadgenChanges(body);
  const results = [];
  for (const c of changes) {
    // Saved to the queue first; if Meta's lead lookup fails, the job runner retries, so we still answer 200
    // (a non-200 makes Meta resend everything and eventually switch the webhook off).
    try { results.push(await receive("meta", c.leadgen_id, c)); }
    catch (e) { results.push({ status: "error", message: (e as Error).message }); }
  }
  after(() => runJobs(["notify", "sheets"]));
  return json({ received: changes.length, results });
}
