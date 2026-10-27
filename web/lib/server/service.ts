import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Server-only database client with the service role: used by webhooks and the job runner, never by pages.
// Row level security does not apply to it, so every caller checks its own authorisation first.
let client: SupabaseClient | null = null;
export function service(): SupabaseClient {
  if (client) return client;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("SUPABASE_SERVICE_ROLE_KEY is not set on the server");
  client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  return client;
}

// Settings that come either from a server environment variable or from an admin-entered secret.
const cache = new Map<string, { v: string | null; at: number }>();
export async function setting(envName: string, secretKey?: string): Promise<string | null> {
  const fromEnv = process.env[envName];
  if (fromEnv) return fromEnv;
  if (!secretKey) return null;
  const hit = cache.get(secretKey);
  if (hit && Date.now() - hit.at < 60_000) return hit.v;
  const { data } = await service().rpc("integration_secret_get", { p_key: secretKey });
  const v = (data as string | null) ?? null;
  cache.set(secretKey, { v, at: Date.now() });
  return v;
}

export const appUrl = () => (process.env.APP_URL ?? (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : "http://localhost:3000")).replace(/\/+$/, "");

export async function logEvent(e: { provider: string; status: string; direction?: "in" | "out"; message?: string; external_id?: string | null; lead_id?: string | null; payload?: unknown }) {
  await service().from("integration_events").insert({
    provider: e.provider, status: e.status, direction: e.direction ?? "in", message: e.message?.slice(0, 1000) ?? null,
    external_id: e.external_id ?? null, lead_id: e.lead_id ?? null, payload: e.payload ?? null,
  });
}

export const json = (body: unknown, status = 200) => Response.json(body, { status });
