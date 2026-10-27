import { useCallback, useEffect, useState } from "react";
import { FlatList, RefreshControl, View } from "react-native";
import { router } from "expo-router";
import { Button, Chip, Empty, Field, Screen, T, s } from "../../components/ui";
import { LeadItem } from "../../components/lead-row";
import { searchLeads, type LeadRow } from "../../lib/data";
import { useSession, canManage } from "../../lib/session";
import { C } from "../../lib/theme";

export default function Leads() {
  const { profile } = useSession();
  const [text, setText] = useState("");
  const [view, setView] = useState<"mine" | "open" | "hot" | "all">("mine");
  const [rows, setRows] = useState<LeadRow[]>([]);
  const [count, setCount] = useState(0);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(false);
  const load = useCallback(async (p = 0) => {
    if (!profile) return;
    setLoading(true);
    try {
      const r = await searchLeads({ q: text, page: p, mine: view === "mine" ? profile.id : null, view });
      setRows((prev) => (p === 0 ? r.rows : [...prev, ...r.rows])); setCount(r.count); setPage(p);
    } catch {} finally { setLoading(false); }
  }, [profile, text, view]);
  useEffect(() => { const t = setTimeout(() => load(0), 300); return () => clearTimeout(t); }, [load]);

  return (
    <Screen>
      <View style={{ padding: 16, gap: 12 }}>
        <View style={[s.row, { justifyContent: "space-between" }]}>
          <T v="h1">Leads</T>
          <Button title="Add" icon="＋" onPress={() => router.push("/new-lead")} style={{ height: 38 }} />
        </View>
        <Field value={text} onChangeText={setText} placeholder="Search name or phone" autoCorrect={false} returnKeyType="search" />
        <View style={[s.row, { gap: 8, flexWrap: "wrap" }]}>
          <Chip label="Mine" active={view === "mine"} onPress={() => setView("mine")} />
          <Chip label="Open" active={view === "open"} onPress={() => setView("open")} />
          <Chip label="Hot" active={view === "hot"} onPress={() => setView("hot")} />
          {canManage(profile) && <Chip label="All" active={view === "all"} onPress={() => setView("all")} />}
          <T v="small" style={{ marginLeft: "auto" }}>{count} found</T>
        </View>
      </View>
      <FlatList
        data={rows}
        keyExtractor={(l) => l.id}
        renderItem={({ item }) => <LeadItem l={item} when="activity" />}
        ItemSeparatorComponent={() => <View style={[s.sep, { marginLeft: 68 }]} />}
        ListEmptyComponent={loading ? undefined : <Empty text="No leads match." />}
        onEndReached={() => { if (!loading && rows.length < count) load(page + 1); }}
        onEndReachedThreshold={0.4}
        refreshControl={<RefreshControl refreshing={loading && page === 0} onRefresh={() => load(0)} tintColor={C.accent} />}
        contentContainerStyle={{ paddingBottom: 110 }}
      />
    </Screen>
  );
}
