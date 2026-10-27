import Constants from "expo-constants";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { sb } from "./supabase";
import { ensureChannel, PUSH_FLAG } from "./alerts";

Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldPlaySound: true, shouldSetBadge: true, shouldShowBanner: true, shouldShowList: true }),
});

// Registers this phone for new-lead and reminder notifications. Needs an Expo project id (set by `eas init`).
export async function registerPush(): Promise<string> {
  if (!Device.isDevice) return "Push notifications need a real phone.";
  await ensureChannel();
  let { status } = await Notifications.getPermissionsAsync();
  if (status !== "granted") ({ status } = await Notifications.requestPermissionsAsync());
  if (status !== "granted") return "Notifications are turned off for this app in the phone settings.";
  const projectId = Constants.expoConfig?.extra?.eas?.projectId ?? (Constants as unknown as { easConfig?: { projectId?: string } }).easConfig?.projectId;
  // Without an Expo project the app still alerts: instantly while open, and from the background check when closed.
  if (!projectId) return "on (in-app and background check; instant push needs the Expo project)";
  try {
    const token = (await Notifications.getExpoPushTokenAsync({ projectId })).data;
    const client = await sb();
    const { data: { session } } = await client.auth.getSession();
    if (!session) return "Sign in first.";
    const { error } = await client.from("push_subscriptions").upsert({ user_id: session.user.id, kind: "expo", endpoint: token, device: `${Device.manufacturer ?? ""} ${Device.modelName ?? ""}`.trim() }, { onConflict: "endpoint" });
    if (!error) await AsyncStorage.setItem(PUSH_FLAG, "on");
    return error ? `Could not save: ${error.message}` : "on";
  } catch (e) { return `Could not register: ${String(e)}`; }
}
