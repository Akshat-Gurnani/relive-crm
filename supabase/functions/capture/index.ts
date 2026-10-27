// Lead capture endpoint.
//   POST https://<project>.supabase.co/functions/v1/capture/<endpoint-slug>
//   Header:  x-capture-secret: <secret>      (or Authorization: Bearer <secret>)
//   Body:    JSON, or form-encoded, as sent by the form tool. Field names are set per endpoint.
// All the real work (phone clean-up, dedupe by person, re-enquiry handling, round-robin) lives in the
// database function public.capture_enquiry, which is covered by tests/behaviour.sql.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

async function sha256Hex(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function readPayload(req: Request): Promise<Record<string, unknown>> {
  const type = req.headers.get("content-type") ?? "";
  if (type.includes("application/json")) return await req.json();
  if (type.includes("application/x-www-form-urlencoded") || type.includes("multipart/form-data")) {
    const form = await req.formData();
    return Object.fromEntries(Array.from(form.entries()).map(([k, v]) => [k, String(v)]));
  }
  throw new Error("unsupported content type");
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "use POST" }, 405);

  const slug = new URL(req.url).pathname.split("/").filter(Boolean).pop();
  if (!slug || slug === "capture") return json({ error: "missing endpoint slug" }, 400);

  const auth = req.headers.get("authorization") ?? "";
  const secret = req.headers.get("x-capture-secret") ?? auth.replace(/^Bearer\s+/i, "");
  if (!secret) return json({ error: "missing secret" }, 401);

  let payload: Record<string, unknown>;
  try {
    payload = await readPayload(req);
  } catch (_e) {
    return json({ error: "body must be JSON or form data" }, 400);
  }

  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false },
  });
  const { data, error } = await db.rpc("capture_enquiry", {
    p_slug: slug,
    p_secret_hash: await sha256Hex(secret),
    p_payload: payload,
  });

  if (error) {
    // 28000 = unknown endpoint or wrong secret
    if (error.code === "28000") return json({ error: "unauthorised" }, 401);
    console.error("capture failed", error.message);
    // 500 makes the sender retry; the 5-minute duplicate guard makes retries safe
    return json({ error: "temporary failure" }, 500);
  }
  return json(data);
});
