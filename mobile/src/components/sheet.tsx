import type { ReactNode } from "react";
import { KeyboardAvoidingView, Modal, Platform, Pressable, View } from "react-native";
import { T, s } from "./ui";
import { C } from "../lib/theme";

// Bottom sheet: tap outside to close.
export function Sheet({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  return (
    <Modal visible={open} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1, width: "100%" }}>
        <Pressable style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.55)" }} onPress={onClose} accessibilityLabel="Close" />
        <View style={{ width: "100%", maxWidth: 640, alignSelf: "center", backgroundColor: "#141821", borderTopLeftRadius: 24, borderTopRightRadius: 24, borderColor: C.line, borderWidth: 1, padding: 20, paddingBottom: 36, gap: 14 }}>
          <View style={{ width: 40, height: 4, borderRadius: 2, backgroundColor: C.line, alignSelf: "center" }} />
          <T v="h2">{title}</T>
          <View style={[s.row, { flexWrap: "wrap", gap: 8 }]}>{children}</View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
