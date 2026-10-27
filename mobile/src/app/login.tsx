import { useEffect, useState } from "react";
import { Image, KeyboardAvoidingView, Platform, Pressable, ScrollView, View } from "react-native";
import { Button, Card, Field, Screen, T } from "../components/ui";
import { getServer, sb, setServer } from "../lib/supabase";
import { useSession } from "../lib/session";
import { clearRefs } from "../lib/data";
import { C } from "../lib/theme";

export default function Login() {
  const { refresh } = useSession();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [url, setUrl] = useState("");
  const [showServer, setShowServer] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  useEffect(() => { getServer().then((s) => { setUrl(s.url); if (!s.url) setShowServer(true); }); }, []);

  const go = async () => {
    setBusy(true); setMsg("");
    try {
      const s = await getServer();
      if (url.trim() && url.trim() !== s.url) await setServer({ url, anonKey: s.anonKey });
      clearRefs();
      const { error } = await (await sb()).auth.signInWithPassword({ email: email.trim(), password });
      if (error) setMsg(
        error.message === "Invalid login credentials" ? "Email or password is incorrect."
        : /fetch|network|abort/i.test(`${error.name} ${error.message}`) ? "Cannot reach the server. Check the server address and that this phone is on the same Wi-Fi as the server."
        : error.message);
      else await refresh();
    } catch (e) { setMsg(`Cannot reach the server. ${String((e as Error).message ?? e)}`); }
    finally { setBusy(false); }
  };

  return (
    <Screen edges={["top", "bottom"]}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: "center", padding: 24, gap: 22 }} keyboardShouldPersistTaps="handled">
          <Image source={require("../../assets/icon.png")} style={{ width: 96, height: 96, borderRadius: 24, alignSelf: "center" }} />
          <View style={{ gap: 6 }}>
            <T v="eyebrow" style={{ color: C.accent2, textAlign: "center" }}>Employee login</T>
            <T v="h1" style={{ textAlign: "center" }}>Relive CRM</T>
            <T v="mute" style={{ textAlign: "center" }}>Your leads, calls and follow-ups, on your phone.</T>
          </View>
          <Card style={{ gap: 14 }}>
            <Field label="Work email" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" autoComplete="email" textContentType="username" />
            <Field label="Password" value={password} onChangeText={setPassword} secureTextEntry autoComplete="password" textContentType="password" onSubmitEditing={go} />
            {msg ? <T v="small" style={{ color: C.bad }}>{msg}</T> : null}
            <Button title="Sign in" onPress={go} loading={busy} disabled={!email || !password} />
          </Card>
          <Pressable onPress={() => setShowServer((x) => !x)}><T v="small" style={{ textAlign: "center" }}>{showServer ? "Hide server" : "Server settings"}</T></Pressable>
          {showServer && (
            <Card style={{ gap: 10 }}>
              <Field label="Server address" value={url} onChangeText={setUrl} autoCapitalize="none" autoCorrect={false} placeholder="http://192.168.1.20:54321" keyboardType="url" />
              <T v="small">For the test version on your Mac, use the address shown by start.sh with --lan. The live version is set by the person who builds the app.</T>
            </Card>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}
