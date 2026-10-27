import { useCallback, useState } from "react";
import { Linking, RefreshControl, ScrollView, View } from "react-native";
import { useFocusEffect } from "expo-router";
import * as Location from "expo-location";
import * as Haptics from "expo-haptics";
import { Button, Card, Field, Screen, T, s } from "../../components/ui";
import { sb } from "../../lib/supabase";
import { useSession } from "../../lib/session";
import { dateTime } from "../../lib/format";
import { C } from "../../lib/theme";

type Row = { id: string; kind: "in" | "out"; at: string; lat: number | null; lng: number | null; address: string | null };

export default function Attendance() {
  const { profile } = useSession();
  const [rows, setRows] = useState<Row[]>([]);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [msg, setMsg] = useState("");
  const load = useCallback(async () => {
    if (!profile) return;
    const { data } = await (await sb()).from("attendance").select("id,kind,at,lat,lng,address").eq("user_id", profile.id).order("at", { ascending: false }).limit(30);
    setRows((data ?? []) as Row[]);
  }, [profile]);
  useFocusEffect(useCallback(() => { load(); }, [load]));
  const last = rows[0]?.kind ?? "out";

  const punch = async (kind: "in" | "out") => {
    if (!profile) return;
    setBusy(true); setMsg("Getting your location…");
    let lat: number | null = null, lng: number | null = null, acc: number | null = null, address: string | null = null;
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status === "granted") {
        const p = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
        lat = p.coords.latitude; lng = p.coords.longitude; acc = p.coords.accuracy ?? null;
        try { const g = (await Location.reverseGeocodeAsync({ latitude: lat, longitude: lng }))[0]; address = g ? [g.name, g.district ?? g.subregion, g.city].filter(Boolean).join(", ") : null; } catch {}
      }
    } catch {}
    const { error } = await (await sb()).from("attendance").insert({ user_id: profile.id, kind, lat, lng, accuracy_m: acc, address, note: note || null, device: "phone" });
    setBusy(false);
    if (error) { setMsg(`Could not save: ${error.message}`); return; }
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setMsg(lat == null ? "Saved without location (location is off)." : kind === "in" ? "Checked in." : "Checked out.");
    setNote(""); load();
  };

  return (
    <Screen>
      <ScrollView contentContainerStyle={{ padding: 16, gap: 14, paddingBottom: 110 }} refreshControl={<RefreshControl refreshing={false} onRefresh={load} tintColor={C.accent} />}>
        <T v="h1">Attendance</T>
        <Card style={{ gap: 12 }}>
          <T v="eyebrow">Today</T>
          <T v="h2">{last === "in" ? "You are checked in" : "You are checked out"}</T>
          {rows[0] ? <T v="small">Last {rows[0].kind === "in" ? "check-in" : "check-out"} {dateTime(rows[0].at)}{rows[0].address ? ` · ${rows[0].address}` : ""}</T> : null}
          <Field value={note} onChangeText={setNote} placeholder="Note (optional), e.g. at Migsun site office" />
          <View style={[s.row, { gap: 10 }]}>
            <Button title="Check in" onPress={() => punch("in")} disabled={last === "in"} loading={busy && last !== "in"} style={{ flex: 1 }} />
            <Button title="Check out" kind="quiet" onPress={() => punch("out")} disabled={last !== "in"} loading={busy && last === "in"} style={{ flex: 1 }} />
          </View>
          {msg ? <T v="small">{msg}</T> : null}
        </Card>
        <Card style={{ padding: 0 }}>
          {rows.map((r, i) => (
            <View key={r.id}>
              {i > 0 && <View style={s.sep} />}
              <View style={[s.row, { padding: 14, justifyContent: "space-between" }]}>
                <T style={{ color: r.kind === "in" ? C.won : C.mute, fontWeight: "700", width: 40 }}>{r.kind === "in" ? "In" : "Out"}</T>
                <T v="small" style={{ flex: 1 }}>{dateTime(r.at)}{r.address ? `\n${r.address}` : ""}</T>
                {r.lat != null ? <Button title="Map" kind="ghost" style={{ height: 32 }} onPress={() => Linking.openURL(`https://www.google.com/maps?q=${r.lat},${r.lng}`)} /> : null}
              </View>
            </View>
          ))}
        </Card>
      </ScrollView>
    </Screen>
  );
}
