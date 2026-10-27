import "../lib/background";
import { useEffect, useRef } from "react";
import { AppState, View, ActivityIndicator, Text, Pressable } from "react-native";
import { Stack, router, useSegments } from "expo-router";
import { StatusBar } from "expo-status-bar";
import * as Notifications from "expo-notifications";
import { SessionProvider, useSession, canWork } from "../lib/session";
import { takePendingCall } from "../lib/pending-call";
import { syncCalls } from "../lib/callsync";
import { ensureBackgroundSync } from "../lib/background";
import { registerPush } from "../lib/push";
import { checkAlerts, startLiveAlerts } from "../lib/alerts";
import { C } from "../lib/theme";

function Gate() {
  const { ready, profile, offline, refresh, forget } = useSession();
  const segments = useSegments();
  const pushed = useRef(false);

  useEffect(() => {
    if (!ready || offline) return;
    const onLogin = segments[0] === "login";
    if (!profile && !onLogin) router.replace("/login");
    if (profile && onLogin) router.replace("/");
  }, [ready, profile, offline, segments]);

  useEffect(() => {
    if (!profile) return;
    if (!pushed.current) { pushed.current = true; registerPush().catch(() => {}); ensureBackgroundSync(); }
    syncCalls().catch(() => {});
    checkAlerts().catch(() => {});
    let stopLive: (() => void) | null = null;
    startLiveAlerts().then((stop) => { stopLive = stop; }).catch(() => {});
    // back from the dialer: sync the phone's call log, then ask how the call went
    const sub = AppState.addEventListener("change", async (s) => {
      if (s !== "active") return;
      syncCalls().catch(() => {});
      checkAlerts().catch(() => {});
      const p = await takePendingCall();
      if (p && canWork(profile)) router.push({ pathname: "/log-call", params: { leadId: p.leadId, phone: p.phone, name: p.name, at: String(p.at) } });
    });
    const tap = Notifications.addNotificationResponseReceivedListener((r) => {
      const leadId = (r.notification.request.content.data as { lead_id?: string } | undefined)?.lead_id;
      if (leadId) router.push(`/lead/${leadId}`);
    });
    return () => { sub.remove(); tap.remove(); stopLive?.(); };
  }, [profile]);

  if (ready && offline) return (
    <View style={{ flex: 1, backgroundColor: C.bg, alignItems: "center", justifyContent: "center", padding: 28, gap: 14 }}>
      <Text style={{ color: C.ink, fontSize: 22, fontWeight: "700", textAlign: "center" }}>Can't reach the CRM server</Text>
      <Text style={{ color: C.mute, fontSize: 15, textAlign: "center", lineHeight: 22 }}>
        The app is set to {offline}. Check that the server is switched on and that this phone is on the same Wi-Fi, then try again.
      </Text>
      <Pressable accessibilityRole="button" onPress={refresh} style={{ backgroundColor: C.accent, borderRadius: 999, paddingVertical: 14, paddingHorizontal: 32, marginTop: 8 }}>
        <Text style={{ color: "#fff", fontSize: 16, fontWeight: "700" }}>Try again</Text>
      </Pressable>
      <Pressable accessibilityRole="button" onPress={forget} style={{ paddingVertical: 10 }}>
        <Text style={{ color: C.mute, fontSize: 15, textDecorationLine: "underline" }}>Sign out and change server</Text>
      </Pressable>
    </View>
  );
  if (!ready) return <View style={{ flex: 1, backgroundColor: C.bg, alignItems: "center", justifyContent: "center" }}><ActivityIndicator color={C.accent} /></View>;
  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: C.bg }, animation: "slide_from_right" }}>
      <Stack.Screen name="(tabs)" />
      <Stack.Screen name="login" options={{ animation: "fade" }} />
      <Stack.Screen name="lead/[id]" />
      <Stack.Screen name="log-call" options={{ presentation: "modal", animation: "slide_from_bottom" }} />
      <Stack.Screen name="new-lead" options={{ presentation: "modal", animation: "slide_from_bottom" }} />
    </Stack>
  );
}

export default function RootLayout() {
  return (
    <SessionProvider>
      <StatusBar style="light" />
      <Gate />
    </SessionProvider>
  );
}
