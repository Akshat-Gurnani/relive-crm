import { useCallback, useState } from "react";
import { Linking, Pressable, RefreshControl, ScrollView, Text, View } from "react-native";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import DateTimePicker from "@react-native-community/datetimepicker";
import * as Haptics from "expo-haptics";
import { Avatar, Button, Card, Chip, Field, Pill, Screen, T, s } from "../../components/ui";
import { Sheet } from "../../components/sheet";
import { sb } from "../../lib/supabase";
import { refs } from "../../lib/data";
import { useSession } from "../../lib/session";
import { callLead } from "../../lib/pending-call";
import { ago, dateTime, fillTemplate, mmss, preset, PRESETS, waLink } from "../../lib/format";
import { C } from "../../lib/theme";

type Lead = {
  id: string; temperature: "hot" | "warm" | "cold"; priority: string; stage_id: string; next_followup_at: string | null; next_followup_note: string | null;
  first_contacted_at: string | null; last_activity_at: string; created_at: string; reenquiry_count: number; description: string | null; budget_band: string | null; unit_size: string | null;
  stage: { name: string; kind: "open" | "won" | "lost" } | null; project: { name: string } | null; source: { name: string } | null;
  person: { full_name: string | null; phone_e164: string; city: string | null; email: string | null };
};
type Item = { at: string; icon: string; title: string; detail?: string | null };

export default function LeadScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { profile } = useSession();
  const [lead, setLead] = useState<Lead | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [r, setR] = useState<Awaited<ReturnType<typeof refs>> | null>(null);
  const [sheet, setSheet] = useState<null | "stage" | "followup" | "whatsapp" | "note">(null);
  const [lostFor, setLostFor] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [fu, setFu] = useState<Date>(new Date(Date.now() + 3600000));
  const [fuNote, setFuNote] = useState("");
  const [picker, setPicker] = useState<null | "date" | "time">(null);
  const [err, setErr] = useState("");

  const load = useCallback(async () => {
    const c = await sb();
    const [l, a, calls, notes, rr] = await Promise.all([
      c.from("leads").select("id,temperature,priority,stage_id,next_followup_at,next_followup_note,first_contacted_at,last_activity_at,created_at,reenquiry_count,description,budget_band,unit_size,stage:stages(name,kind),project:projects(name),source:sources(name),person:people(full_name,phone_e164,city,email)").eq("id", id).maybeSingle(),
      c.from("activities").select("type,outcome,notes,created_at").eq("lead_id", id).order("created_at", { ascending: false }).limit(50),
      c.from("calls").select("direction,status,duration_seconds,started_at,outcome,notes,provider").eq("lead_id", id).order("started_at", { ascending: false }).limit(50),
      c.from("lead_notes").select("body,created_at").eq("lead_id", id).order("created_at", { ascending: false }).limit(50),
      refs(),
    ]);
    setLead(l.data as unknown as Lead); setR(rr);
    const ICON: Record<string, string> = { call: "📞", whatsapp: "💬", email: "✉️", meeting: "🤝", note: "✍️", re_enquiry: "♻️", site_visit: "📍", system: "🤖" };
    setItems([
      ...((a.data ?? []) as { type: string; outcome: string | null; notes: string | null; created_at: string }[]).map((x) => ({ at: x.created_at, icon: ICON[x.type] ?? "•", title: `${x.type.replace("_", " ")}${x.outcome ? ` · ${x.outcome}` : ""}`, detail: x.notes })),
      ...((calls.data ?? []) as { direction: string; status: string; duration_seconds: number; started_at: string; outcome: string | null; notes: string | null; provider: string }[]).map((x) => ({
        at: x.started_at, icon: x.status === "missed" ? "📵" : "📞", title: `${x.direction === "incoming" ? "Incoming" : "Call"} · ${x.duration_seconds ? mmss(x.duration_seconds) : x.status.replace("_", " ")}${x.outcome ? ` · ${x.outcome}` : ""}${x.provider === "android" ? " · from phone" : ""}`, detail: x.notes })),
      ...((notes.data ?? []) as { body: string; created_at: string }[]).map((x) => ({ at: x.created_at, icon: "✍️", title: "Note", detail: x.body })),
    ].sort((p, q) => +new Date(q.at) - +new Date(p.at)));
  }, [id]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  if (!lead || !r) return <Screen><View style={{ padding: 20 }}><T v="mute">Loading…</T></View></Screen>;
  const name = lead.person.full_name || lead.person.phone_e164;
  const overdue = lead.next_followup_at && +new Date(lead.next_followup_at) < Date.now() && lead.stage?.kind === "open";
  const vars = { name: lead.person.full_name?.split(" ")[0] ?? "", project: lead.project?.name ?? "our projects", agent: profile?.full_name ?? "", agent_phone: profile?.phone ?? "" };

  const update = async (patch: Record<string, unknown>) => {
    setErr("");
    const { error } = await (await sb()).from("leads").update(patch).eq("id", id);
    if (error) { setErr(error.message); return false; }
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setSheet(null); setLostFor(null); load(); return true;
  };
  const setStage = async (stageId: string, kind: string, reason?: string) => {
    if (kind === "lost" && !reason) { setLostFor(stageId); return; }
    await update({ stage_id: stageId, ...(reason ? { lost_reason_id: reason, next_followup_at: null, next_followup_note: null } : {}), ...(kind === "won" ? { next_followup_at: null } : {}) });
  };
  const addNote = async () => {
    if (!note.trim() || !profile) return;
    const { error } = await (await sb()).from("lead_notes").insert({ lead_id: id, body: note.trim(), created_by: profile.id });
    if (error) { setErr(error.message); return; }
    setNote(""); setSheet(null); load();
  };

  return (
    <Screen>
      <View style={[s.row, { paddingHorizontal: 12, paddingVertical: 8 }]}>
        <Button title="‹ Back" kind="ghost" onPress={() => router.back()} style={{ height: 36, paddingHorizontal: 8 }} />
      </View>
      <ScrollView contentContainerStyle={{ padding: 16, gap: 14, paddingBottom: 60 }} refreshControl={<RefreshControl refreshing={false} onRefresh={load} tintColor={C.accent} />}>
        <View style={[s.row, { gap: 14 }]}>
          <Avatar name={name} size={60} />
          <View style={{ flex: 1, gap: 4 }}>
            <T v="h2" numberOfLines={2}>{name}</T>
            <T v="mute">{lead.person.phone_e164}{lead.person.city ? ` · ${lead.person.city}` : ""}</T>
            <View style={[s.row, { gap: 6, flexWrap: "wrap" }]}>
              {lead.stage && <Pill text={lead.stage.name} color={lead.stage.kind === "won" ? C.won : lead.stage.kind === "lost" ? C.faint : C.accent} />}
              <Pill text={`${lead.temperature} · ${lead.priority}`} color={lead.temperature === "hot" ? C.bad : lead.temperature === "warm" ? C.warn : C.sky} />
            </View>
          </View>
        </View>

        <View style={[s.row, { gap: 10 }]}>
          <Button title="Call" icon="📞" onPress={() => callLead({ leadId: lead.id, phone: lead.person.phone_e164, name })} style={{ flex: 1 }} />
          <Button title="WhatsApp" icon="💬" kind="quiet" onPress={() => setSheet("whatsapp")} style={{ flex: 1 }} />
        </View>
        <View style={[s.row, { gap: 10 }]}>
          <Button title="Stage" kind="quiet" onPress={() => setSheet("stage")} style={{ flex: 1 }} />
          <Button title="Follow-up" kind="quiet" onPress={() => { setFuNote(lead.next_followup_note ?? ""); setSheet("followup"); }} style={{ flex: 1 }} />
          <Button title="Note" kind="quiet" onPress={() => setSheet("note")} style={{ flex: 1 }} />
        </View>
        {err ? <T v="small" style={{ color: C.bad }}>{err}</T> : null}

        <Card style={{ gap: 8 }}>
          <View style={[s.row, { justifyContent: "space-between" }]}><T v="small">Next follow-up</T><T style={{ color: overdue ? C.bad : C.ink, fontWeight: "600" }}>{lead.next_followup_at ? dateTime(lead.next_followup_at) : "None set"}</T></View>
          {lead.next_followup_note ? <T v="small">{lead.next_followup_note}</T> : null}
          <View style={s.sep} />
          <View style={[s.row, { justifyContent: "space-between" }]}><T v="small">Project</T><T>{lead.project?.name ?? "–"}</T></View>
          <View style={[s.row, { justifyContent: "space-between" }]}><T v="small">Source</T><T>{lead.source?.name ?? "–"}</T></View>
          {lead.budget_band ? <View style={[s.row, { justifyContent: "space-between" }]}><T v="small">Budget</T><T>{lead.budget_band}</T></View> : null}
          {lead.unit_size ? <View style={[s.row, { justifyContent: "space-between" }]}><T v="small">Size</T><T>{lead.unit_size}</T></View> : null}
          <View style={[s.row, { justifyContent: "space-between" }]}><T v="small">First contact</T><T style={{ color: lead.first_contacted_at ? C.ink : C.bad }}>{lead.first_contacted_at ? dateTime(lead.first_contacted_at) : "Not yet"}</T></View>
          {lead.reenquiry_count ? <T v="small" style={{ color: C.warn }}>Enquired again {lead.reenquiry_count} time(s)</T> : null}
          {lead.description ? <T v="small">{lead.description}</T> : null}
        </Card>

        <View style={[s.row, { justifyContent: "space-between" }]}>
          <T v="eyebrow">Timeline</T>
          <Pressable onPress={() => router.push({ pathname: "/log-call", params: { leadId: lead.id, phone: lead.person.phone_e164, name, manual: "1" } })}><T v="small" style={{ color: C.accent2 }}>Log a call by hand</T></Pressable>
        </View>
        <Card style={{ padding: 0 }}>
          {items.length === 0 ? <View style={{ padding: 16 }}><T v="mute">Nothing logged yet.</T></View> : items.map((it, i) => (
            <View key={i}>
              {i > 0 && <View style={s.sep} />}
              <View style={[s.row, { padding: 14, alignItems: "flex-start" }]}>
                <Text style={{ fontSize: 18 }}>{it.icon}</Text>
                <View style={{ flex: 1, gap: 2 }}>
                  <View style={[s.row, { justifyContent: "space-between" }]}><T style={{ fontWeight: "600", flex: 1, textTransform: "capitalize" }} numberOfLines={2}>{it.title}</T><T v="small">{ago(it.at)}</T></View>
                  {it.detail ? <T v="small" style={{ color: C.ink, opacity: 0.85 }}>{it.detail}</T> : null}
                </View>
              </View>
            </View>
          ))}
        </Card>
      </ScrollView>

      <Sheet open={sheet === "stage"} onClose={() => { setSheet(null); setLostFor(null); }} title={lostFor ? "Why was it lost?" : "Move to stage"}>
        {lostFor
          ? r.reasons.map((x) => <Chip key={x.id} label={x.name} onPress={() => setStage(lostFor, "lost", x.id)} />)
          : r.stages.map((x) => <Chip key={x.id} label={x.name} active={x.id === lead.stage_id} onPress={() => setStage(x.id, x.kind)} />)}
        {!lostFor && <>
          <View style={{ width: "100%", height: 8 }} />
          {(["hot", "warm", "cold"] as const).map((t) => <Chip key={t} label={t === "hot" ? "🔥 Hot" : t === "warm" ? "⭐ Warm" : "🥶 Cold"} active={lead.temperature === t} onPress={() => update({ temperature: t })} />)}
        </>}
      </Sheet>

      <Sheet open={sheet === "followup"} onClose={() => setSheet(null)} title="Next follow-up">
        {PRESETS.map(([k, l]) => <Chip key={k} label={l} onPress={() => setFu(new Date(preset(k)))} />)}
        <View style={{ width: "100%", gap: 10, marginTop: 8 }}>
          <View style={[s.row, { gap: 10 }]}>
            <Button title={fu.toLocaleDateString("en-IN", { day: "2-digit", month: "short" })} kind="quiet" onPress={() => setPicker("date")} style={{ flex: 1 }} />
            <Button title={fu.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" })} kind="quiet" onPress={() => setPicker("time")} style={{ flex: 1 }} />
          </View>
          {picker && <DateTimePicker value={fu} mode={picker} onChange={(_, d) => { setPicker(null); if (d) setFu(d); }} />}
          <Field value={fuNote} onChangeText={setFuNote} placeholder="What to do on that call" />
          <Button title={`Set for ${dateTime(fu.toISOString())}`} onPress={() => update({ next_followup_at: fu.toISOString(), next_followup_note: fuNote || null })} />
          <Button title="Clear follow-up" kind="ghost" onPress={() => update({ next_followup_at: null, next_followup_note: null })} />
        </View>
      </Sheet>

      <Sheet open={sheet === "whatsapp"} onClose={() => setSheet(null)} title="WhatsApp">
        <View style={{ width: "100%", gap: 8 }}>
          <Button title="Open chat" kind="quiet" onPress={() => { setSheet(null); Linking.openURL(waLink(lead.person.phone_e164)); }} />
          {r.templates.filter((t) => t.channel === "whatsapp").map((t) => (
            <Button key={t.id} title={t.name} kind="quiet" onPress={() => { setSheet(null); Linking.openURL(waLink(lead.person.phone_e164, fillTemplate(t.body, vars))); }} />
          ))}
        </View>
      </Sheet>

      <Sheet open={sheet === "note"} onClose={() => setSheet(null)} title="Add a note">
        <View style={{ width: "100%", gap: 10 }}>
          <Field value={note} onChangeText={setNote} multiline placeholder="Anything worth remembering about this person" autoFocus />
          <Button title="Save note" onPress={addNote} disabled={!note.trim()} />
        </View>
      </Sheet>
    </Screen>
  );
}

