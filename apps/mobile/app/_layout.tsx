import * as Notifications from "expo-notifications";
import { router, Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";
import { Platform } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { AuthProvider, useAuth } from "@/auth";
import { appRouteForPath, openWeb } from "@/links";
import { getPushToken } from "@/push";
import { usePalette } from "@/ui";

/** Registers this device for push once signed in, and routes taps on notifications. */
function PushBridge() {
  const { status, request, rememberPushToken } = useAuth();

  useEffect(() => {
    if (status !== "signedIn") return;
    let cancelled = false;
    void (async () => {
      try {
        const token = await getPushToken();
        if (!token || cancelled) return;
        await request("/api/mobile/push-tokens", { method: "POST", body: { token, platform: Platform.OS === "ios" ? "ios" : "android" } });
        await rememberPushToken(token);
      } catch (error) {
        console.warn("[push] registration failed", error);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [status, request, rememberPushToken]);

  useEffect(() => {
    const open = (data: Record<string, unknown> | undefined) => {
      const href = typeof data?.href === "string" ? data.href : null;
      const route = appRouteForPath(href);
      if (route) router.push(route as never);
      else if (href) void openWeb(href);
    };
    const subscription = Notifications.addNotificationResponseReceivedListener((response) => open(response.notification.request.content.data as Record<string, unknown> | undefined));
    void Notifications.getLastNotificationResponseAsync().then((response) => {
      if (response) open(response.notification.request.content.data as Record<string, unknown> | undefined);
    });
    return () => subscription.remove();
  }, []);

  return null;
}

export default function RootLayout() {
  const palette = usePalette();
  return (
    <SafeAreaProvider>
      <AuthProvider>
        <PushBridge />
        <StatusBar style="auto" />
        <Stack screenOptions={{ headerBackTitle: "Back", headerTintColor: palette.text, headerStyle: { backgroundColor: palette.card }, contentStyle: { backgroundColor: palette.bg } }}>
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen name="login" options={{ presentation: "modal", title: "Sign in" }} />
          <Stack.Screen name="listing/[slug]" options={{ title: "" }} />
          <Stack.Screen name="order/[id]" options={{ title: "Order" }} />
          <Stack.Screen name="conversation/[id]" options={{ title: "Messages" }} />
        </Stack>
      </AuthProvider>
    </SafeAreaProvider>
  );
}
