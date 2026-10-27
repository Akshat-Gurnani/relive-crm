import AsyncStorage from "@react-native-async-storage/async-storage";
import { PermissionsAndroid, Platform } from "react-native";
import * as Device from "expo-device";
import { decode } from "base64-arraybuffer";
import CallLog, { type DeviceCall } from "../../modules/call-log-sync";
import { sb } from "./supabase";

const LAST = "relive.calls.lastSync";
const DEVICE = "relive.device.id";

// Automatic call logging needs the Android app build. iPhone and Expo Go fall back to the after-call form.
export const autoCallLogAvailable = Platform.OS === "android" && !!CallLog;

export async function deviceId() {
  let id = await AsyncStorage.getItem(DEVICE);
  if (!id) { id = `${Device.modelName ?? "phone"}-${Math.random().toString(36).slice(2, 10)}`; await AsyncStorage.setItem(DEVICE, id); }
  return id;
}

export async function callPermissions(ask: boolean) {
  if (!autoCallLogAvailable) return { calls: false, audio: false };
  const P = PermissionsAndroid.PERMISSIONS;
  const audioPerm = (Platform.Version as number) >= 33 ? P.READ_MEDIA_AUDIO : P.READ_EXTERNAL_STORAGE;
  if (ask) await PermissionsAndroid.requestMultiple([P.READ_CALL_LOG, audioPerm]);
  return { calls: await PermissionsAndroid.check(P.READ_CALL_LOG), audio: await PermissionsAndroid.check(audioPerm) };
}

export async function lastSync() { return Number((await AsyncStorage.getItem(LAST)) ?? 0); }

function toPayload(c: DeviceCall, dev: string) {
  const incoming = c.type === "incoming" || c.type === "missed" || c.type === "rejected";
  const status = c.type === "missed" ? "missed" : c.type === "rejected" || c.type === "blocked" ? "rejected" : c.duration > 0 ? "connected" : "not_connected";
  return { phone: c.number, direction: incoming ? "incoming" : "outgoing", status, started_at: new Date(c.date).toISOString(),
           duration_seconds: c.duration, provider: "android", device_call_id: `${dev}:${c.id}`, device: dev };
}

// Sends every call since the last sync. Calls to numbers that are not leads are stored too, so nothing is lost.
export async function syncCalls(opts: { recordings?: boolean } = {}) {
  if (!autoCallLogAvailable) return { synced: 0, matched: 0, skipped: "not-android" as const };
  const perms = await callPermissions(false);
  if (!perms.calls) return { synced: 0, matched: 0, skipped: "no-permission" as const };
  const client = await sb();
  const { data: { session } } = await client.auth.getSession();
  if (!session) return { synced: 0, matched: 0, skipped: "signed-out" as const };
  const dev = await deviceId();
  // first run: only the last 2 days, so an old phone does not flood the CRM
  const since = (await lastSync()) || Date.now() - 2 * 86400000;
  const calls = await CallLog!.readCalls(since, 500);
  if (!calls.length) return { synced: 0, matched: 0 };
  const { data, error } = await client.rpc("log_calls", { p_calls: calls.map((c) => toPayload(c, dev)) });
  if (error) throw error;
  await AsyncStorage.setItem(LAST, String(calls[calls.length - 1].date));
  if (opts.recordings !== false && perms.audio) {
    for (const c of calls.filter((x) => x.duration > 5)) {
      try {
        const uri = await CallLog!.findRecording(c.date, c.duration, c.number);
        if (!uri) continue;
        const b64 = await CallLog!.readAsBase64(uri, 15 * 1024 * 1024);
        if (!b64) continue;
        const path = `${session.user.id}/${dev}-${c.id}.m4a`;
        const up = await client.storage.from("call-recordings").upload(path, decode(b64), { contentType: "audio/mp4", upsert: true });
        if (!up.error) await client.rpc("attach_recording", { p_device_call_id: `${dev}:${c.id}`, p_path: path });
      } catch { /* recordings are best effort; the local test server has no file storage */ }
    }
  }
  const r = data as { logged: number; matched: number };
  return { synced: r.logged, matched: r.matched };
}

// The most recent call to this number, read from the phone (used to pre-fill the after-call form).
export async function lastCallTo(phone: string, sinceMs: number): Promise<DeviceCall | null> {
  if (!autoCallLogAvailable || !(await callPermissions(false)).calls) return null;
  const digits = phone.replace(/\D/g, "").slice(-10);
  const calls = await CallLog!.readCalls(sinceMs - 5000, 50);
  return [...calls].reverse().find((c) => c.number.replace(/\D/g, "").endsWith(digits)) ?? null;
}
