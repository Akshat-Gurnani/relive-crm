import { router } from "expo-router";
import { Pressable, Text, View } from "react-native";
import * as Haptics from "expo-haptics";
import { Avatar, T, s } from "./ui";
import { C } from "../lib/theme";
import { ago, dateTime } from "../lib/format";
import type { LeadRow } from "../lib/data";
import { callLead } from "../lib/pending-call";

const TEMP: Record<string, string> = { hot: "🔥", warm: "⭐", cold: "🥶" };

export function LeadItem({ l, when }: { l: LeadRow; when: "created" | "followup" | "activity" }) {
  const name = l.person.full_name || l.person.phone_e164;
  const overdue = l.next_followup_at && +new Date(l.next_followup_at) < Date.now() && l.stage?.kind === "open";
  return (
    <Pressable onPress={() => router.push(`/lead/${l.id}`)} style={({ pressed }) => [{ paddingVertical: 12, paddingHorizontal: 16, backgroundColor: pressed ? "rgba(255,255,255,0.05)" : "transparent" }]}>
      <View style={s.row}>
        <Avatar name={name} size={40} />
        <View style={{ flex: 1, gap: 2 }}>
          <View style={[s.row, { gap: 6 }]}>
            <T numberOfLines={1} style={{ fontWeight: "700", flexShrink: 1 }}>{name}</T>
            <Text>{TEMP[l.temperature]}</Text>
            {l.priority === "High" ? <Text style={{ color: C.accent2, fontSize: 10, fontWeight: "800" }}>HIGH</Text> : null}
          </View>
          <T v="small" numberOfLines={1}>{l.project?.name ?? "No project"} · {l.stage?.name}{l.reenquiry_count ? ` · re-enquired ×${l.reenquiry_count}` : ""}</T>
          <T v="small" numberOfLines={1} style={overdue ? { color: C.bad } : undefined}>
            {when === "created" ? `Arrived ${ago(l.created_at)}` : when === "followup" ? `${dateTime(l.next_followup_at)}${l.next_followup_note ? ` · ${l.next_followup_note}` : ""}` : `Active ${ago(l.last_activity_at)}`}
          </T>
        </View>
        <Pressable
          hitSlop={8}
          onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); callLead({ leadId: l.id, phone: l.person.phone_e164, name }); }}
          style={({ pressed }) => ({ width: 44, height: 44, borderRadius: 22, backgroundColor: pressed ? C.accent2 : C.accent, alignItems: "center", justifyContent: "center" })}
          accessibilityLabel={`Call ${name}`}
        >
          <Text style={{ fontSize: 18 }}>📞</Text>
        </Pressable>
      </View>
    </Pressable>
  );
}
