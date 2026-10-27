import { useCallback, useState } from "react";
import { Pressable, RefreshControl, ScrollView, Text, View } from "react-native";
import { router, useFocusEffect } from "expo-router";
import * as Haptics from "expo-haptics";
import { Button, Card, Chip, Empty, Field, Screen, T, s } from "../../components/ui";
import { sb } from "../../lib/supabase";
import { useSession } from "../../lib/session";
import { dateTime, preset, PRESETS } from "../../lib/format";
import { C } from "../../lib/theme";

type Task = { id: string; title: string; due_at: string | null; status: "open" | "done"; category: string | null; lead: { id: string; person: { full_name: string | null } | null } | null };

export default function Tasks() {
  const { profile } = useSession();
  const [tab, setTab] = useState<"open" | "done">("open");
  const [rows, setRows] = useState<Task[]>([]);
  const [loading, setLoading] = useState(false);
  const [title, setTitle] = useState("");
  const [due, setDue] = useState<string | null>(null);
  const load = useCallback(async () => {
    if (!profile) return;
    setLoading(true);
    const c = await sb();
    const { data } = await c.from("tasks").select("id,title,due_at,status,category,lead:leads(id,person:people(full_name))")
      .eq("assigned_to", profile.id).eq("status", tab).order(tab === "open" ? "due_at" : "completed_at", { ascending: tab === "open", nullsFirst: false }).limit(200);
    setRows((data ?? []) as unknown as Task[]); setLoading(false);
  }, [profile, tab]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const toggle = async (t: Task) => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setRows((r) => r.filter((x) => x.id !== t.id));
    await (await sb()).from("tasks").update({ status: t.status === "open" ? "done" : "open" }).eq("id", t.id);
  };
  const add = async () => {
    if (!title.trim() || !profile) return;
    await (await sb()).from("tasks").insert({ title: title.trim(), assigned_to: profile.id, created_by: profile.id, due_at: due });
    setTitle(""); setDue(null); load();
  };
  const now = Date.now();
  return (
    <Screen>
      <ScrollView contentContainerStyle={{ padding: 16, gap: 14, paddingBottom: 110 }} refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={C.accent} />} keyboardShouldPersistTaps="handled">
        <T v="h1">Tasks</T>
        <Card style={{ gap: 10 }}>
          <Field value={title} onChangeText={setTitle} placeholder="New task, e.g. send price sheet" onSubmitEditing={add} />
          <View style={[s.row, { flexWrap: "wrap", gap: 8 }]}>{PRESETS.map(([k, l]) => <Chip key={k} label={l} active={due === preset(k) || false} onPress={() => setDue(preset(k))} />)}</View>
          {due && <T v="small">Due {dateTime(due)}</T>}
          <Button title="Add task" onPress={add} disabled={!title.trim()} />
        </Card>
        <View style={[s.row, { gap: 8 }]}><Chip label="To do" active={tab === "open"} onPress={() => setTab("open")} /><Chip label="Done" active={tab === "done"} onPress={() => setTab("done")} /></View>
        <Card style={{ padding: 0, overflow: "hidden" }}>
          {rows.length === 0 ? <Empty text={tab === "open" ? "Nothing to do. Nice." : "No finished tasks yet."} /> : rows.map((t, i) => {
            const late = t.status === "open" && t.due_at && +new Date(t.due_at) < now;
            return (
              <View key={t.id}>
                {i > 0 && <View style={s.sep} />}
                <View style={[s.row, { padding: 14 }]}>
                  <Pressable onPress={() => toggle(t)} hitSlop={10} style={{ width: 26, height: 26, borderRadius: 8, borderWidth: 1.5, borderColor: t.status === "done" ? C.won : C.line, backgroundColor: t.status === "done" ? C.won + "33" : "transparent", alignItems: "center", justifyContent: "center" }}>
                    {t.status === "done" ? <Text style={{ color: C.won, fontWeight: "800" }}>✓</Text> : null}
                  </Pressable>
                  <Pressable style={{ flex: 1 }} onPress={() => t.lead && router.push(`/lead/${t.lead.id}`)}>
                    <T style={{ fontWeight: "600", textDecorationLine: t.status === "done" ? "line-through" : "none" }}>{t.title}</T>
                    <T v="small" style={late ? { color: C.bad } : undefined}>{t.due_at ? `Due ${dateTime(t.due_at)}` : "No due date"}{t.lead?.person?.full_name ? ` · ${t.lead.person.full_name}` : ""}</T>
                  </Pressable>
                </View>
              </View>
            );
          })}
        </Card>
      </ScrollView>
    </Screen>
  );
}
