import { useCallback, useState } from "react";
import { RefreshControl, ScrollView, View } from "react-native";
import { router, useFocusEffect } from "expo-router";
import { Button, Card, Empty, Screen, T, s } from "../../components/ui";
import { LeadItem } from "../../components/lead-row";
import { myQueue, type LeadRow } from "../../lib/data";
import { useSession, canWork } from "../../lib/session";
import { C } from "../../lib/theme";

type Q = Awaited<ReturnType<typeof myQueue>>;

export default function Today() {
  const { profile } = useSession();
  const [q, setQ] = useState<Q | null>(null);
  const [loading, setLoading] = useState(false);
  const load = useCallback(async () => {
    if (!profile || !canWork(profile)) return;
    setLoading(true);
    try { setQ(await myQueue(profile.id)); } catch {} finally { setLoading(false); }
  }, [profile]);
  useFocusEffect(useCallback(() => { load(); }, [load]));
  const first = profile?.full_name.split(" ")[0] ?? "";
  const hour = Number(new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", hour: "numeric", hour12: false }).format(new Date()));

  if (profile && !canWork(profile)) return <Screen><View style={{ padding: 24 }}><T v="h1">Hello {first}</T><T v="mute">Reports are on the web dashboard. Use this app for attendance.</T></View></Screen>;

  const groups: [string, LeadRow[], "created" | "followup", string][] = q ? [
    ["Call these first", q.fresh, "created", C.bad], ["Overdue", q.overdue, "followup", C.bad], ["Due today", q.today, "followup", C.accent2], ["Coming up", q.later, "followup", C.mute],
  ] : [];
  return (
    <Screen>
      <ScrollView contentContainerStyle={{ paddingBottom: 110 }} refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={C.accent} />}>
        <View style={{ padding: 20, gap: 4 }}>
          <T v="eyebrow">{hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening"}</T>
          <T v="h1">{first}, here is your day</T>
        </View>
        <View style={[s.row, { paddingHorizontal: 16, gap: 10 }]}>
          {[["New", q?.fresh.length ?? 0, C.bad], ["Overdue", q?.overdue.length ?? 0, C.bad], ["Today", q?.today.length ?? 0, C.accent2]].map(([l, n, col]) => (
            <Card key={l as string} style={{ flex: 1, paddingVertical: 14 }}>
              <T v="small">{l as string}</T>
              <T v="num" style={{ color: (n as number) ? (col as string) : C.faint }}>{String(n)}</T>
            </Card>
          ))}
        </View>
        <View style={{ padding: 16 }}><Button title="Add a lead" icon="＋" kind="quiet" onPress={() => router.push("/new-lead")} /></View>
        {q && groups.map(([title, rows, when, col]) => (
          <View key={title} style={{ marginBottom: 14 }}>
            <View style={[s.row, { paddingHorizontal: 20, marginBottom: 4, justifyContent: "space-between" }]}>
              <T v="eyebrow" style={{ color: rows.length ? col : C.faint }}>{title}</T>
              <T v="small">{rows.length}</T>
            </View>
            <Card style={{ marginHorizontal: 16, padding: 0, overflow: "hidden" }}>
              {rows.length === 0 ? <Empty text={title === "Call these first" ? "Nothing waiting for a first call." : "Nothing here."} /> :
                rows.map((l, i) => <View key={l.id}>{i > 0 && <View style={s.sep} />}<LeadItem l={l} when={when} /></View>)}
            </Card>
          </View>
        ))}
      </ScrollView>
    </Screen>
  );
}
