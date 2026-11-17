import { Tabs } from "expo-router";
import { Text, type ColorValue } from "react-native";
import { usePalette } from "@/ui";
import { useMe } from "@/use-me";

function Icon({ glyph, color }: { glyph: string; color: ColorValue }) {
  return <Text style={{ fontSize: 18, color }}>{glyph}</Text>;
}

export default function TabsLayout() {
  const palette = usePalette();
  const me = useMe();
  const badge = (count: number | undefined) => (count && count > 0 ? (count > 99 ? "99+" : count) : undefined);
  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: palette.text,
        tabBarInactiveTintColor: palette.muted,
        tabBarStyle: { backgroundColor: palette.card, borderTopColor: palette.border },
        headerStyle: { backgroundColor: palette.card },
        headerTintColor: palette.text,
        sceneStyle: { backgroundColor: palette.bg },
      }}
    >
      <Tabs.Screen name="index" options={{ title: "Browse", tabBarIcon: ({ color }) => <Icon glyph="⌕" color={color} /> }} />
      <Tabs.Screen name="orders" options={{ title: "Orders", tabBarIcon: ({ color }) => <Icon glyph="▤" color={color} /> }} />
      <Tabs.Screen name="messages" options={{ title: "Messages", tabBarBadge: badge(me?.unreadMessages), tabBarIcon: ({ color }) => <Icon glyph="✉" color={color} /> }} />
      <Tabs.Screen name="alerts" options={{ title: "Alerts", tabBarBadge: badge(me?.unreadNotifications), tabBarIcon: ({ color }) => <Icon glyph="◉" color={color} /> }} />
      <Tabs.Screen name="account" options={{ title: "Account", tabBarIcon: ({ color }) => <Icon glyph="☺" color={color} /> }} />
    </Tabs>
  );
}
