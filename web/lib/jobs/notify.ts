import "server-only";
import webpush from "web-push";
import { appUrl, service, setting } from "@/lib/server/service";

// Delivers alerts that the database queued in `notifications`:
//   1. push to the web app (browser push) and the phone app (Expo push), the first priority;
//   2. email, for the kinds each person chose (new lead, lead passed to you, re-enquiry...).
// The in-app bell needs nothing from here: it reads the same table.

type Claimed = {
  id: string; user_id: string; kind: string; title: string; body: string | null; lead_id: string | null; created_at: string; name: string;
  push: boolean; email: string | null;
  subscriptions: { kind: "web" | "expo"; endpoint: string; keys: { p256dh?: string; auth?: string } | null }[];
};

const EXPO_PUSH = () => process.env.EXPO_PUSH_URL ?? "https://exp.host/--/api/v2/push/send";
const RESEND = () => (process.env.RESEND_BASE ?? "https://api.resend.com").replace(/\/+$/, "");

let vapidReady: boolean | null = null;
function vapid(): boolean {
  if (vapidReady !== null) return vapidReady;
  const pub = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY, priv = process.env.VAPID_PRIVATE_KEY;
  vapidReady = !!(pub && priv);
  if (vapidReady) webpush.setVapidDetails(process.env.VAPID_SUBJECT ?? "mailto:crm@relivesolutions.com", pub!, priv!);
  return vapidReady;
}

const leadLink = (n: Claimed) => (n.lead_id ? `${appUrl()}/leads/${n.lead_id}` : `${appUrl()}/notifications`);

async function sendPush(n: Claimed, stats: Record<string, number>) {
  const db = service();
  const payload = { title: n.title, body: n.body ?? "", lead_id: n.lead_id, url: n.lead_id ? `/leads/${n.lead_id}` : "/notifications" };
  const expo = n.subscriptions.filter((s) => s.kind === "expo").map((s) => s.endpoint);
  for (const s of n.subscriptions.filter((x) => x.kind === "web")) {
    if (!vapid() || !s.keys?.p256dh || !s.keys?.auth) continue;
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.keys.p256dh, auth: s.keys.auth } }, JSON.stringify(payload), { TTL: 3600 });
      stats.web++;
    } catch (e) {
      const code = (e as { statusCode?: number }).statusCode;
      if (code === 404 || code === 410) await db.rpc("push_subscription_remove", { p_endpoint: s.endpoint });
      stats.push_failed++;
    }
  }
  if (expo.length) {
    try {
      const res = await fetch(EXPO_PUSH(), {
        method: "POST", headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify(expo.map((to) => ({ to, title: n.title, body: n.body ?? "", data: { lead_id: n.lead_id }, sound: "default", priority: "high", channelId: "leads" }))),
        signal: AbortSignal.timeout(10_000),
      });
      const out = (await res.json().catch(() => ({}))) as { data?: { status: string; details?: { error?: string } }[] };
      (out.data ?? []).forEach((t, i) => { if (t.details?.error === "DeviceNotRegistered") void db.rpc("push_subscription_remove", { p_endpoint: expo[i] }); });
      stats.expo += expo.length;
    } catch { stats.push_failed++; }
  }
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

function emailHtml(n: Claimed) {
  return `<!doctype html><html><body style="margin:0;background:#0f141c;font-family:Helvetica,Arial,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:28px 12px">
<table role="presentation" width="100%" style="max-width:520px;background:#161d28;border-radius:14px;color:#e8edf5">
<tr><td style="padding:22px 26px 6px;font-size:12px;letter-spacing:.12em;color:#f07a5a;text-transform:uppercase">Relive CRM</td></tr>
<tr><td style="padding:4px 26px 0;font-size:20px;font-weight:700">${esc(n.title)}</td></tr>
<tr><td style="padding:8px 26px 0;font-size:15px;color:#b8c2d3">${esc(n.body ?? "")}</td></tr>
<tr><td style="padding:22px 26px 26px"><a href="${leadLink(n)}" style="display:inline-block;background:#e8603c;color:#fff;text-decoration:none;font-weight:700;padding:11px 20px;border-radius:999px">${n.lead_id ? "Open the lead" : "Open alerts"}</a></td></tr>
</table>
<p style="color:#6b7689;font-size:11.5px;margin:14px 0 0">You get these because of your alert settings in Relive CRM, under Alerts.</p>
</td></tr></table></body></html>`;
}

async function sendEmail(n: Claimed): Promise<string> {
  const key = await setting("RESEND_API_KEY", "resend_api_key");
  if (!key) return "not_configured";
  const from = (await setting("EMAIL_FROM", "email_from")) ?? "Relive CRM <onboarding@resend.dev>";
  const res = await fetch(`${RESEND()}/emails`, {
    method: "POST", headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify({ from, to: [n.email], subject: n.title, html: emailHtml(n), text: `${n.title}\n${n.body ?? ""}\n\n${leadLink(n)}`, tags: [{ name: "kind", value: n.kind }] }),
    signal: AbortSignal.timeout(10_000),
  }).catch((e: Error) => ({ ok: false, status: 0, json: async () => ({ message: e.message }) }) as unknown as Response);
  if (res.ok) return "sent";
  const err = (await res.json().catch(() => ({}))) as { message?: string };
  return `failed ${res.status}: ${err.message ?? ""}`.trim();
}

export async function deliverNotifications(limit = 200) {
  const db = service();
  const { data, error } = await db.rpc("notification_claim", { p_limit: limit });
  if (error) throw new Error(`notification claim failed: ${error.message}`);
  const items = (data ?? []) as Claimed[];
  const stats: Record<string, number> = { claimed: items.length, web: 0, expo: 0, push_failed: 0, emailed: 0, email_failed: 0, email_off: 0 };
  await Promise.all(items.map(async (n) => {
    if (n.push && n.subscriptions.length) await sendPush(n, stats);
    if (n.email) {
      const r = await sendEmail(n);
      if (r === "sent") stats.emailed++; else if (r === "not_configured") stats.email_off++; else stats.email_failed++;
      await db.rpc("notification_email_result", { p_id: n.id, p_status: r });
    }
  }));
  return stats;
}
