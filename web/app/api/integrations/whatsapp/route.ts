import { timingSafeEqual } from "node:crypto";
import { json, setting, service, logEvent } from "@/lib/server/service";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

// Receives builder-group messages from the read-only WhatsApp bridge.
//   Auth: header "Authorization: Bearer <token>", the value saved as WA_BRIDGE_TOKEN (or under Admin, Integrations).
//   The bridge only ever posts here. Nothing in the CRM sends anything back to WhatsApp.
// Media: the bridge sends small files inline as base64 (Vercel allows about 4 MB per request); anything larger is
// stored as a message without a file and flagged, so a missing file never blocks the text around it.

const KINDS = ["text", "image", "document", "video", "audio", "other"] as const;
type Kind = (typeof KINDS)[number];
const MAX_INLINE_BYTES = 3_000_000;

function sameToken(given: string, expected: string) {
  const a = Buffer.from(given), b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

const clean = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");

export async function POST(req: Request) {
  const expected = await setting("WA_BRIDGE_TOKEN", "wa_bridge_token");
  if (!expected) return json({ error: "not configured" }, 503);
  const given = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!given || !sameToken(given, expected)) {
    await logEvent({ provider: "whatsapp", status: "rejected", message: "bad token" });
    return json({ error: "unauthorised" }, 401);
  }

  let body: any;
  try { body = await req.json(); } catch { return json({ error: "bad json" }, 400); }
  const jid = clean(body?.group?.jid, 100);
  const gname = clean(body?.group?.name, 200) || jid;
  const m = body?.message;
  const mid = clean(m?.id, 200);
  if (!jid || !mid) return json({ error: "group.jid and message.id are required" }, 400);

  const db = service();
  // First sight of a group creates it (unmapped, active). An admin then links it to a project, or switches it off.
  const { data: group, error: gErr } = await db.from("wa_groups")
    .upsert({ wa_jid: jid, name: gname }, { onConflict: "wa_jid", ignoreDuplicates: false }).select("id, active").single();
  if (gErr || !group) return json({ error: gErr?.message ?? "group failed" }, 500);
  if (!group.active) return json({ ok: true, skipped: "group switched off" });

  const kind: Kind = KINDS.includes(m?.kind) ? m.kind : "other";
  const sentAt = new Date(m?.sent_at ?? Date.now());
  let filePath: string | null = null;
  let note: string | null = null;
  const b64 = typeof m?.file_base64 === "string" ? m.file_base64 : "";
  if (b64) {
    const bytes = Buffer.from(b64, "base64");
    if (bytes.length > MAX_INLINE_BYTES) note = "file too large to store inline";
    else {
      const safe = clean(m?.file_name, 120).replace(/[^\w.\- ]+/g, "_") || "file";
      filePath = `${group.id}/${sentAt.toISOString().slice(0, 10)}/${mid}-${safe}`;
      const up = await db.storage.from("wa-media").upload(filePath, bytes, { contentType: clean(m?.mime, 100) || undefined, upsert: true });
      if (up.error) { note = `file not stored: ${up.error.message}`; filePath = null; }
    }
  }

  const { error } = await db.from("wa_messages").upsert({
    group_id: group.id, wa_message_id: mid,
    sender_jid: clean(m?.sender_jid, 100) || null, sender_name: clean(m?.sender_name, 200) || null,
    sent_at: Number.isNaN(sentAt.getTime()) ? new Date().toISOString() : sentAt.toISOString(),
    kind, body: clean(m?.body, 20000) || null,
    file_path: filePath, file_name: clean(m?.file_name, 200) || null, mime: clean(m?.mime, 100) || null,
    process_error: note,
  }, { onConflict: "group_id,wa_message_id", ignoreDuplicates: true });
  if (error) return json({ error: error.message }, 500);

  await db.from("wa_groups").update({ last_message_at: new Date().toISOString() }).eq("id", group.id);
  return json({ ok: true });
}
