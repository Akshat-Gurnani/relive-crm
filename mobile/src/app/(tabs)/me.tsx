import { useCallback, useState } from "react";
import { ScrollView, View } from "react-native";
import { useFocusEffect } from "expo-router";
import { Avatar, Button, Card, Screen, T, s } from "../../components/ui";
import { useSession } from "../../lib/session";
import { autoCallLogAvailable, callPermissions, lastSync, syncCalls } from "../../lib/callsync";
import { registerPush } from "../../lib/push";
import { getServer } from "../../lib/supabase";
import { dateTime } from "../../lib/format";
import { C } from "../../lib/theme";

export default function Me() {
  const { profile, signOut } = useSession();
  const [perm, setPerm] = useState({ calls: false, audio: false });
  const [last, setLast] = useState(0);
  const [msg, setMsg] = useState("");
  const [push, setPush] = useState("");
  const [server, setServerUrl] = useState("");
  const load = useCallback(async () => {
    setPerm(await callPermissions(false)); setLast(await lastSync()); setServerUrl((await getServer()).url);
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const sync = async () => {
    setMsg("Syncing…");
    try { const r = await syncCalls(); setMsg("skipped" in r && r.skipped ? `Not synced: ${r.skipped.replace("-", " ")}` : `${r.synced} new call(s), ${r.matched} matched to leads.`); }
    catch (e) { setMsg(`Sync failed: ${String((e as Error).message ?? e)}`); }
    load();
  };
  return (
    <Screen>
      <ScrollView contentContainerStyle={{ padding: 16, gap: 14, paddingBottom: 110 }}>
        <View style={[s.row, { paddingVertical: 8 }]}>
          <Avatar name={profile?.full_name} size={56} />
          <View><T v="h2">{profile?.full_name}</T><T v="small" style={{ textTransform: "capitalize" }}>{profile?.role}</T></View>
        </View>

        <Card style={{ gap: 10 }}>
          <T v="eyebrow">Automatic call logging</T>
          {autoCallLogAvailable ? <>
            <T v="mute">Every call you make or receive on this phone is copied to the CRM and matched to the lead, with the dialer's recording when the phone saves one.</T>
            <T v="small">Call log access: <T v="small" style={{ color: perm.calls ? C.won : C.bad }}>{perm.calls ? "allowed" : "not allowed"}</T> · Recordings: <T v="small" style={{ color: perm.audio ? C.won : C.warn }}>{perm.audio ? "allowed" : "not allowed"}</T></T>
            <T v="small">Last synced: {last ? dateTime(new Date(last).toISOString()) : "never"}</T>
            {!perm.calls ? <Button title="Allow call log access" onPress={async () => { await callPermissions(true); load(); }} /> : <Button title="Sync calls now" kind="quiet" onPress={sync} />}
            {msg ? <T v="small">{msg}</T> : null}
          </> : <T v="mute">iPhones do not let any app read calls. After each call from this app, you will be asked how it went, and that is saved to the lead.</T>}
        </Card>

        <Card style={{ gap: 10 }}>
          <T v="eyebrow">Notifications</T>
          <T v="mute">New leads, leads passed to you, and reminders 15 minutes before a follow-up.</T>
          <Button title="Turn on notifications" kind="quiet" onPress={async () => setPush(await registerPush())} />
          {push ? <T v="small" style={{ color: push === "on" ? C.won : C.warn }}>{push === "on" ? "Notifications are on for this phone." : push}</T> : null}
        </Card>

        <Card style={{ gap: 6 }}>
          <T v="eyebrow">Server</T>
          <T v="small">{server}</T>
        </Card>
        <Button title="Sign out" kind="danger" onPress={signOut} />
      </ScrollView>
    </Screen>
  );
}
