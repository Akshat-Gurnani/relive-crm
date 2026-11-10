import { useCallback, useEffect, useState } from "react";
import { AppState, Modal, Pressable, Text, View, ActivityIndicator } from "react-native";
import { C, R } from "../lib/theme";
import { checkForUpdate, cleanOldDownloads, currentVersionName, downloadAndInstall, onUpdateCheckRequested, type Release } from "../lib/updates";

// "Update available" sheet. Appears when a newer APK has been published in the web CRM (Admin > Phone app).
export function UpdatePrompt() {
  const [rel, setRel] = useState<Release | null>(null);
  const [later, setLater] = useState<number | null>(null); // version the person postponed this session
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const check = useCallback(async (force = false) => {
    const r = await checkForUpdate(force);
    if (r) setRel(r);
  }, []);

  useEffect(() => {
    cleanOldDownloads();
    check(true);
    const sub = AppState.addEventListener("change", (s) => { if (s === "active") check(); });
    const off = onUpdateCheckRequested(() => { setLater(null); check(true); });
    return () => { sub.remove(); off(); };
  }, [check]);

  const install = async () => {
    if (!rel) return;
    setError(null); setProgress(0);
    try {
      await downloadAndInstall(rel, setProgress);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Download failed");
    } finally {
      setProgress(null);
    }
  };

  if (!rel || (later === rel.version_code && !rel.mandatory)) return null;
  const mb = rel.size_bytes ? ` (${Math.round(rel.size_bytes / 1048576)} MB)` : "";
  const busy = progress !== null;

  return (
    <Modal transparent animationType="fade" visible statusBarTranslucent onRequestClose={() => { if (!rel.mandatory && !busy) setLater(rel.version_code); }}>
      <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.6)", justifyContent: "flex-end" }}>
        <View style={{ backgroundColor: "#141821", borderTopLeftRadius: R.lg, borderTopRightRadius: R.lg, padding: 24, paddingBottom: 36, gap: 12, borderWidth: 1, borderColor: C.line }}>
          <Text style={{ color: C.accent, fontSize: 13, fontWeight: "700", letterSpacing: 1 }}>UPDATE AVAILABLE</Text>
          <Text style={{ color: C.ink, fontSize: 22, fontWeight: "700" }}>Relive CRM {rel.version_name}</Text>
          <Text style={{ color: C.mute, fontSize: 14 }}>You have {currentVersionName() || "an older version"}.{rel.mandatory ? " This update is required to keep using the app." : ""}</Text>
          {!!rel.notes && <Text style={{ color: C.ink, fontSize: 15, lineHeight: 22 }}>{rel.notes}</Text>}
          {busy ? (
            <View style={{ gap: 8, marginTop: 6 }}>
              <View style={{ height: 8, borderRadius: 4, backgroundColor: C.cardStrong, overflow: "hidden" }}>
                <View style={{ height: 8, width: `${Math.round((progress ?? 0) * 100)}%`, backgroundColor: C.accent }} />
              </View>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                <ActivityIndicator color={C.accent} size="small" />
                <Text style={{ color: C.mute, fontSize: 14 }}>{progress! < 1 ? `Downloading… ${Math.round(progress! * 100)}%` : "Opening the installer…"}</Text>
              </View>
            </View>
          ) : <>
            <Pressable accessibilityRole="button" onPress={install} style={{ backgroundColor: C.accent, borderRadius: R.pill, paddingVertical: 15, alignItems: "center", marginTop: 6 }}>
              <Text style={{ color: "#fff", fontSize: 16, fontWeight: "700" }}>Download and install{mb}</Text>
            </Pressable>
            {!rel.mandatory && (
              <Pressable accessibilityRole="button" onPress={() => setLater(rel.version_code)} style={{ paddingVertical: 10, alignItems: "center" }}>
                <Text style={{ color: C.mute, fontSize: 15 }}>Later</Text>
              </Pressable>
            )}
          </>}
          {!!error && <Text style={{ color: C.bad, fontSize: 14 }}>{error}. Check your internet and try again.</Text>}
          <Text style={{ color: C.faint, fontSize: 12, lineHeight: 18 }}>Android will show an Install screen. The first time, it may ask you to allow Relive CRM to install apps: turn that on, come back, and tap Install. Your sign-in and data stay as they are.</Text>
        </View>
      </View>
    </Modal>
  );
}
