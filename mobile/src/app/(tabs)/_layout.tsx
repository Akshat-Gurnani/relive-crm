import { BlurView } from "expo-blur";
import { Tabs } from "expo-router";
import { StyleSheet, Text } from "react-native";
import { useSession, canWork } from "../../lib/session";
import { C } from "../../lib/theme";

const icon = (e: string) => ({ focused }: { focused: boolean }) => <Text style={{ fontSize: focused ? 24 : 21, opacity: focused ? 1 : 0.6 }}>{e}</Text>;

export default function TabLayout() {
  const { profile } = useSession();
  const work = canWork(profile);
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: C.ink,
        tabBarInactiveTintColor: C.faint,
        tabBarLabelStyle: { fontSize: 11, fontWeight: "700" },
        tabBarStyle: { position: "absolute", borderTopColor: C.line, backgroundColor: "transparent", elevation: 0 },
        tabBarBackground: () => <BlurView intensity={60} tint="dark" style={StyleSheet.absoluteFill} />,
      }}
    >
      <Tabs.Screen name="index" options={{ title: "Today", tabBarIcon: icon("🔔"), href: work ? undefined : null }} />
      <Tabs.Screen name="leads" options={{ title: "Leads", tabBarIcon: icon("🏠"), href: work ? undefined : null }} />
      <Tabs.Screen name="tasks" options={{ title: "Tasks", tabBarIcon: icon("✅"), href: work ? undefined : null }} />
      <Tabs.Screen name="attendance" options={{ title: "Attendance", tabBarIcon: icon("📍") }} />
      <Tabs.Screen name="me" options={{ title: "Me", tabBarIcon: icon("👤") }} />
    </Tabs>
  );
}
