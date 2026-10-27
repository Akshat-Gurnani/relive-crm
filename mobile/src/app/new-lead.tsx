import { useEffect, useState } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, View } from "react-native";
import { router } from "expo-router";
import { Button, Card, Chip, Field, Screen, T, s } from "../components/ui";
import { sb } from "../lib/supabase";
import { refs } from "../lib/data";
import { C } from "../lib/theme";

// Walk-ins, references and direct calls. Duplicates are caught by the server and become re-enquiries.
export default function NewLead() {
  const [r, setR] = useState<Awaited<ReturnType<typeof refs>> | null>(null);
  const [phone, setPhone] = useState("");
  const [name, setName] = useState("");
  const [city, setCity] = useState("");
  const [project, setProject] = useState<string | null>(null);
  const [source, setSource] = useState<string | null>(null);
  const [temp, setTemp] = useState<"hot" | "warm" | "cold">("warm");
  const [desc, setDesc] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  useEffect(() => { refs().then(setR); }, []);

  const save = async () => {
    setBusy(true); setMsg("");
    const { data, error } = await (await sb()).rpc("create_lead", { p: { phone, full_name: name, city, project_id: project, source_id: source, temperature: temp, description: desc } });
    setBusy(false);
    if (error) { setMsg(error.message); return; }
    const d = data as { status: string; lead_id: string; owner?: string; visible?: boolean };
    if (d.status === "exists" && !d.visible) { setMsg(`Already a lead, owned by ${d.owner ?? "a colleague"}. They have been told.`); return; }
    router.replace(`/lead/${d.lead_id}`);
  };

  return (
    <Screen edges={["top", "bottom"]}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ padding: 20, gap: 14 }} keyboardShouldPersistTaps="handled">
          <View style={[s.row, { justifyContent: "space-between" }]}><T v="h1">Add a lead</T><Button title="Close" kind="ghost" onPress={() => router.back()} style={{ height: 34 }} /></View>
          <Field label="Mobile number" value={phone} onChangeText={setPhone} keyboardType="phone-pad" placeholder="98765 43210" autoFocus />
          <Field label="Name" value={name} onChangeText={setName} autoCapitalize="words" />
          <Field label="City" value={city} onChangeText={setCity} />
          <Card style={{ gap: 10 }}>
            <T v="small">Project</T>
            <View style={[s.row, { flexWrap: "wrap", gap: 8 }]}>{r?.projects.map((x) => <Chip key={x.id} label={x.name} active={project === x.id} onPress={() => setProject(project === x.id ? null : x.id)} />)}</View>
          </Card>
          <Card style={{ gap: 10 }}>
            <T v="small">Source</T>
            <View style={[s.row, { flexWrap: "wrap", gap: 8 }]}>{r?.sources.filter((x) => ["Walk-in", "Reference", "Direct", "Event", "Website", "Other"].includes(x.name)).map((x) => <Chip key={x.id} label={x.name} active={source === x.id} onPress={() => setSource(x.id)} />)}</View>
          </Card>
          <View style={[s.row, { gap: 8 }]}>{(["hot", "warm", "cold"] as const).map((t) => <Chip key={t} label={t === "hot" ? "🔥 Hot" : t === "warm" ? "⭐ Warm" : "🥶 Cold"} active={temp === t} onPress={() => setTemp(t)} />)}</View>
          <Field label="Notes" value={desc} onChangeText={setDesc} multiline placeholder="What are they looking for?" />
          {msg ? <T v="small" style={{ color: C.warn }}>{msg}</T> : null}
          <Button title="Save lead" onPress={save} loading={busy} disabled={phone.replace(/\D/g, "").length < 10} />
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}
