import { BlurView } from "expo-blur";
import type { ReactNode } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View, type PressableProps, type TextInputProps, type TextStyle, type ViewStyle } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { C, R } from "../lib/theme";

// Night navy with the brand's navy and coral glows behind everything, like relivesolutions.com.
export function Backdrop() {
  return (
    <View style={[StyleSheet.absoluteFill, { overflow: "hidden" }]} pointerEvents="none">
      <View style={[s.glow, { backgroundColor: C.navy, top: -160, left: -140, opacity: 0.55 }]} />
      <View style={[s.glow, { backgroundColor: C.accent, top: 120, right: -220, opacity: 0.16 }]} />
      <BlurView intensity={90} tint="dark" style={StyleSheet.absoluteFill} />
    </View>
  );
}

export function Screen({ children, edges = ["top"] }: { children: ReactNode; edges?: ("top" | "bottom")[] }) {
  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <Backdrop />
      <SafeAreaView edges={edges} style={{ flex: 1 }}>{children}</SafeAreaView>
    </View>
  );
}

export function Card({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  return <View style={[s.card, style]}>{children}</View>;
}

export function T({ children, style, v = "body", numberOfLines }: { children: ReactNode; style?: TextStyle; v?: "h1" | "h2" | "body" | "mute" | "small" | "eyebrow" | "num"; numberOfLines?: number }) {
  return <Text numberOfLines={numberOfLines} style={[s.t, s[v], style]}>{children}</Text>;
}

export function Button({ title, onPress, kind = "primary", disabled, loading, icon, style }: { title: string; onPress?: PressableProps["onPress"]; kind?: "primary" | "quiet" | "ghost" | "danger"; disabled?: boolean; loading?: boolean; icon?: string; style?: ViewStyle }) {
  return (
    <Pressable
      onPress={onPress} disabled={disabled || loading} accessibilityRole="button" accessibilityLabel={title}
      style={({ pressed }) => [s.btn, kind === "primary" ? s.btnPrimary : kind === "quiet" ? s.btnQuiet : kind === "danger" ? s.btnDanger : s.btnGhost,
        { opacity: disabled ? 0.4 : 1, transform: [{ scale: pressed ? 0.97 : 1 }] }, style]}
    >
      {loading ? <ActivityIndicator color="#fff" /> : <Text style={[s.btnText, kind === "ghost" && { color: C.mute }]}>{icon ? `${icon}  ` : ""}{title}</Text>}
    </Pressable>
  );
}

export function Chip({ label, active, onPress }: { label: string; active?: boolean; onPress?: () => void }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [s.chip, active && s.chipActive, { transform: [{ scale: pressed ? 0.96 : 1 }] }]}>
      <Text style={[s.chipText, active && { color: C.ink }]}>{label}</Text>
    </Pressable>
  );
}

export function Field(props: TextInputProps & { label?: string }) {
  return (
    <View style={{ gap: 6 }}>
      {props.label ? <Text style={s.label}>{props.label}</Text> : null}
      <TextInput placeholderTextColor={C.faint} {...props} style={[s.input, props.multiline && { minHeight: 80, textAlignVertical: "top", paddingTop: 12 }, props.style]} />
    </View>
  );
}

export function Pill({ text, color = C.accent }: { text: string; color?: string }) {
  return (
    <View style={[s.pill, { borderColor: color + "55", backgroundColor: color + "1f" }]}>
      <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: color }} />
      <Text style={{ color: C.ink, fontSize: 12, fontWeight: "600" }}>{text}</Text>
    </View>
  );
}

export function Avatar({ name, size = 36 }: { name?: string | null; size?: number }) {
  const label = (name || "?").trim();
  const initials = label.split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase()).join("") || "?";
  let h = 0; for (const c of label) h = (h * 31 + c.charCodeAt(0)) % 360;
  const bg = h % 2 ? "#2f4a8f" : "#9a3f2c";
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: bg, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: "rgba(255,255,255,0.12)" }}>
      <Text style={{ color: "#fff", fontWeight: "700", fontSize: size * 0.36 }}>{initials}</Text>
    </View>
  );
}

export function Empty({ text }: { text: string }) {
  return <View style={{ padding: 28, alignItems: "center" }}><T v="mute" style={{ textAlign: "center" }}>{text}</T></View>;
}

export const s = StyleSheet.create({
  glow: { position: "absolute", width: 460, height: 460, borderRadius: 230 },
  card: { backgroundColor: C.card, borderColor: C.line, borderWidth: 1, borderRadius: R.md, padding: 16 },
  t: { color: C.ink, fontSize: 15 },
  h1: { fontSize: 28, fontWeight: "800", letterSpacing: -0.6 },
  h2: { fontSize: 18, fontWeight: "700", letterSpacing: -0.3 },
  body: {},
  mute: { color: C.mute, fontSize: 14 },
  small: { color: C.mute, fontSize: 12 },
  eyebrow: { color: C.mute, fontSize: 11, fontWeight: "700", letterSpacing: 1.4, textTransform: "uppercase" },
  num: { fontSize: 30, fontWeight: "800", letterSpacing: -1 },
  btn: { height: 46, borderRadius: R.pill, paddingHorizontal: 18, alignItems: "center", justifyContent: "center", flexDirection: "row" },
  btnPrimary: { backgroundColor: C.accent, shadowColor: C.accent, shadowOpacity: 0.5, shadowRadius: 14, shadowOffset: { width: 0, height: 6 }, elevation: 6 },
  btnQuiet: { backgroundColor: C.cardStrong, borderWidth: 1, borderColor: C.line },
  btnGhost: { backgroundColor: "transparent" },
  btnDanger: { backgroundColor: "rgba(255,99,99,0.15)", borderWidth: 1, borderColor: "rgba(255,99,99,0.4)" },
  btnText: { color: "#fff", fontSize: 15, fontWeight: "700" },
  chip: { paddingHorizontal: 14, height: 36, borderRadius: R.pill, borderWidth: 1, borderColor: C.line, backgroundColor: C.card, justifyContent: "center" },
  chipActive: { borderColor: C.accent + "99", backgroundColor: C.accent + "26" },
  chipText: { color: C.mute, fontSize: 13, fontWeight: "600" },
  label: { color: C.mute, fontSize: 12, fontWeight: "600" },
  input: { height: 48, borderRadius: 14, borderWidth: 1, borderColor: C.line, backgroundColor: "rgba(255,255,255,0.04)", color: C.ink, paddingHorizontal: 14, fontSize: 15 },
  pill: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 10, height: 26, borderRadius: R.pill, borderWidth: 1, alignSelf: "flex-start" },
  row: { flexDirection: "row", alignItems: "center", gap: 12 },
  sep: { height: 1, backgroundColor: C.line },
});
