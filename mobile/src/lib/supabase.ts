import AsyncStorage from "@react-native-async-storage/async-storage";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { AppState } from "react-native";

// The local test server's public key. It is fixed because the local gateway signs it with a fixed test secret.
export const LOCAL_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoiYW5vbiIsImlzcyI6ImxvY2FsLXRlc3QiLCJpYXQiOjE3MDAwMDAwMDAsImV4cCI6NDEwMjQ0NDgwMH0.3Zeh_8WMM39IONQiy_CwXBu2r8g8We284-FHEh_u4KM";
const KEY = "relive.server.v2"; // v2: earlier test builds stored a Wi-Fi address; start fresh on the cloud server

export type Server = { url: string; anonKey: string };
export const defaultServer: Server = {
  url: process.env.EXPO_PUBLIC_SUPABASE_URL ?? "",
  anonKey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? LOCAL_ANON_KEY,
};

let client: SupabaseClient | null = null;

// A phone on the wrong Wi-Fi, or a server that is switched off, can leave a request hanging for minutes.
// Every request gives up after 12 seconds so the app can say what is wrong instead of spinning.
const TIMEOUT_MS = 12000;
const timedFetch: typeof fetch = (input, init) => {
  const ctrl = new AbortController();
  const outer = init?.signal;
  if (outer) { if (outer.aborted) ctrl.abort(); else outer.addEventListener("abort", () => ctrl.abort()); }
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  return fetch(input, { ...init, signal: ctrl.signal }).finally(() => clearTimeout(t));
};

/** Signs out on this phone only, without calling the server. */
export async function localSignOut() {
  try {
    const keys = await AsyncStorage.getAllKeys();
    await AsyncStorage.multiRemove(keys.filter((k) => k.startsWith("sb-")));
  } catch {}
  client = null;
}
let current: Server | null = null;

export async function getServer(): Promise<Server> {
  if (current) return current;
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (raw) current = JSON.parse(raw);
  } catch {}
  current = current?.url ? current : defaultServer;
  return current;
}
export async function setServer(s: Server) {
  const url = s.url.trim().replace(/\/+$/, "");
  current = { url: /^https?:\/\//.test(url) ? url : `http://${url}`, anonKey: s.anonKey.trim() || LOCAL_ANON_KEY };
  await AsyncStorage.setItem(KEY, JSON.stringify(current));
  client = null;
}

export async function sb(): Promise<SupabaseClient> {
  if (client) return client;
  const s = await getServer();
  if (!s.url) throw new Error("Set the server address on the sign-in screen first.");
  client = createClient(s.url, s.anonKey, {
    global: { fetch: timedFetch },
    auth: { storage: AsyncStorage, autoRefreshToken: true, persistSession: true, detectSessionInUrl: false },
  });
  return client;
}

// Keep the session fresh only while the app is open.
AppState.addEventListener("change", async (state) => {
  if (!client) return;
  if (state === "active") client.auth.startAutoRefresh(); else client.auth.stopAutoRefresh();
});
