import AsyncStorage from "@react-native-async-storage/async-storage";
import { Linking } from "react-native";

// Tap-to-call remembers which lead was called, so the app can ask how it went when the agent comes back.
const KEY = "relive.pendingCall";
export type PendingCall = { leadId: string; phone: string; name: string; at: number };

export async function callLead(p: Omit<PendingCall, "at">) {
  await AsyncStorage.setItem(KEY, JSON.stringify({ ...p, at: Date.now() }));
  await Linking.openURL(`tel:${p.phone}`);
}
export async function takePendingCall(): Promise<PendingCall | null> {
  const raw = await AsyncStorage.getItem(KEY);
  if (!raw) return null;
  const p = JSON.parse(raw) as PendingCall;
  if (Date.now() - p.at < 4000) return null; // the dialer has not really opened yet
  await AsyncStorage.removeItem(KEY);
  return Date.now() - p.at > 3 * 3600000 ? null : p;
}
