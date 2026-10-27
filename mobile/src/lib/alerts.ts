import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { sb } from "./supabase";

// Phone alerts that work without a push service:
//  - while the app is open, new rows in `notifications` arrive instantly over a live connection;
//  - while it is closed, the background task (about every 15 minutes) shows anything new since last time.
// When the app is linked to Expo push (the server then pushes instantly), the background check stands down.
const SEEN = "relive.alerts.seen";
export const PUSH_FLAG = "relive.push.expo";
export const CHANNEL = "leads";

type Row = { id: string; title: string; body: string | null; lead_id: string | null; created_at: string };

export async function ensureChannel() {
  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync(CHANNEL, {
      name: "New leads and reminders", importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 250, 150, 250], lightColor: "#f06043", sound: "default",
    });
  }
}

async function show(n: Row) {
  await Notifications.scheduleNotificationAsync({
    identifier: n.id,
    content: { title: n.title, body: n.body ?? "", data: { lead_id: n.lead_id }, sound: "default" },
    trigger: Platform.OS === "android" ? { channelId: CHANNEL } : null,
  }).catch(() => {});
}

async function remember(at: string) {
  const prev = await AsyncStorage.getItem(SEEN);
  if (!prev || prev < at) await AsyncStorage.setItem(SEEN, at);
}

/** Shows alerts created since the last check (up to 8, newest last). The very first run only sets the mark. */
export async function checkAlerts(): Promise<number> {
  if ((await AsyncStorage.getItem(PUSH_FLAG)) === "on") return 0;
  const client = await sb();
  const { data: { session } } = await client.auth.getSession();
  if (!session) return 0;
  const since = await AsyncStorage.getItem(SEEN);
  if (!since) { await AsyncStorage.setItem(SEEN, new Date().toISOString()); return 0; }
  const { data } = await client.from("notifications").select("id,title,body,lead_id,created_at")
    .eq("user_id", session.user.id).is("read_at", null).gt("created_at", since).order("created_at").limit(8);
  const rows = (data ?? []) as Row[];
  for (const n of rows) await show(n);
  if (rows.length) await remember(rows[rows.length - 1].created_at);
  return rows.length;
}

/** Live alerts while the app is open. Returns a function that stops listening. */
export async function startLiveAlerts(onAlert?: (n: Row) => void): Promise<() => void> {
  const client = await sb();
  const { data: { session } } = await client.auth.getSession();
  if (!session) return () => {};
  await ensureChannel();
  if (!(await AsyncStorage.getItem(SEEN))) await AsyncStorage.setItem(SEEN, new Date().toISOString());
  const ch: RealtimeChannel = client.channel(`alerts-${session.user.id}`)
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "notifications", filter: `user_id=eq.${session.user.id}` }, async (p) => {
      const n = p.new as Row;
      if ((await AsyncStorage.getItem(PUSH_FLAG)) !== "on") await show(n);
      await remember(n.created_at);
      onAlert?.(n);
    })
    .subscribe();
  return () => { void client.removeChannel(ch); };
}
