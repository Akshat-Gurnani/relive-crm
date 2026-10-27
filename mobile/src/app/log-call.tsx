import { useEffect, useState } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import * as Haptics from "expo-haptics";
import { Button, Card, Chip, Field, Screen, T, s } from "../components/ui";
import { sb } from "../lib/supabase";
import { refs } from "../lib/data";
import { lastCallTo, syncCalls } from "../lib/callsync";
import { dateTime, mmss, preset, PRESETS } from "../lib/format";
import { C } from "../lib/theme";

// Shown when the agent comes back from the dialer (or taps "log a call"). On Android the phone's own record of the
// call fills in the time and result; on iPhone the agent confirms them.
export default function LogCall() {
  const p = useLocalSearchParams<{ leadId: string; phone: string; name: string; at?: string; manual?: string }>();
  const [outcomes, setOutcomes] = useState<string[]>([]);
  const [outcome, setOutcome] = useState("");
  const [secs, setSecs] = useState(p.at ? String(Math.max(0, Math.round((Date.now() - Number(p.at)) / 1000) - 5)) : "");
  const [fromPhone, setFromPhone] = useState(false);
  const [notes, setNotes] = useState("");
  const [fu, setFu] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    refs().then((r) => setOutcomes(r.picklists.call_outcome ?? ["Connected, interested", "Connected, call later", "Connected, not interested", "No answer", "Busy", "Switched off"]));
    if (p.at) lastCallTo(p.phone, Number(p.at)).then((c) => {
      if (!c) return;
      setFromPhone(true); setSecs(String(c.duration));
      if (c.duration === 0) setOutcome("No answer");
    }).catch(() => {});
  }, [p.at, p.phone]);

  const save = async () => {
    setBusy(true); setErr("");
    const c = await sb();
    if (fromPhone) {
      // Android: the call itself is synced from the phone; this adds the outcome and notes as an activity.
      await syncCalls({ recordings: false }).catch(() => {});
      const { data: { session } } = await c.auth.getSession();
      const { error } = await c.from("activities").insert({ lead_id: p.leadId, type: "call", outcome: outcome || null, notes: notes || null, assigned_to: session?.user.id, created_by: session?.user.id, completed_at: new Date().toISOString() });
      if (error) { setErr(error.message); setBusy(false); return; }
    } else {
      const { error } = await c.rpc("log_call", { p: { lead_id: p.leadId, phone: p.phone, direction: "outgoing", duration_seconds: Number(secs) || 0, outcome: outcome || null, notes: notes || null, provider: Platform.OS === "ios" ? "ios" : "manual", status: Number(secs) > 0 && !/no answer|busy|switched/i.test(outcome) ? "connected" : "not_connected" } });
      if (error) { setErr(error.message); setBusy(false); return; }
    }
    if (fu) await c.from("leads").update({ next_followup_at: fu, next_followup_note: outcome || null }).eq("id", p.leadId);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setBusy(false); router.back();
  };

  return (
    <Screen edges={["top", "bottom"]}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ padding: 20, gap: 16 }} keyboardShouldPersistTaps="handled">
          <View style={[s.row, { justifyContent: "space-between" }]}>
            <T v="eyebrow">{p.manual ? "Log a call" : "How did the call go?"}</T>
            <Button title="Skip" kind="ghost" onPress={() => router.back()} style={{ height: 34 }} />
          </View>
          <T v="h1">{p.name}</T>
          {fromPhone ? <T v="small" style={{ color: C.won }}>Read from your phone: {mmss(Number(secs))} talk time. The call itself is logged automatically.</T> : null}
          <Card style={{ gap: 10 }}>
            <T v="small">Result</T>
            <View style={[s.row, { flexWrap: "wrap", gap: 8 }]}>{outcomes.map((o) => <Chip key={o} label={o} active={outcome === o} onPress={() => setOutcome(o)} />)}</View>
          </Card>
          {!fromPhone && <Field label="Talk time (seconds)" value={secs} onChangeText={setSecs} keyboardType="number-pad" />}
          <Field label="Notes" value={notes} onChangeText={setNotes} multiline placeholder="Budget, timing, objections…" />
          <Card style={{ gap: 10 }}>
            <T v="small">Next follow-up {fu ? `· ${dateTime(fu)}` : ""}</T>
            <View style={[s.row, { flexWrap: "wrap", gap: 8 }]}>{PRESETS.map(([k, l]) => <Chip key={k} label={l} active={fu === preset(k)} onPress={() => setFu(preset(k))} />)}</View>
          </Card>
          {err ? <T v="small" style={{ color: C.bad }}>{err}</T> : null}
          <Button title="Save" onPress={save} loading={busy} disabled={!outcome} />
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}
