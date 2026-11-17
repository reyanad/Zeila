import { router, useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { FlatList, Pressable, RefreshControl, Text, View } from "react-native";
import { ApiError, type NotificationItem } from "@/api";
import { useAuth } from "@/auth";
import { timeAgo } from "@/format";
import { appRouteForPath, openWeb } from "@/links";
import { SignInPrompt } from "@/sign-in-prompt";
import { Button, Loading, Notice, usePalette } from "@/ui";

export default function AlertsScreen() {
  const palette = usePalette();
  const { status, request } = useAuth();
  const [items, setItems] = useState<NotificationItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      setItems((await request<{ items: NotificationItem[] }>("/api/mobile/notifications")).items);
      setError(null);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Could not load alerts.");
    }
  }, [request]);

  useFocusEffect(
    useCallback(() => {
      if (status === "signedIn") void load();
    }, [status, load]),
  );

  if (status === "loading") return <Loading />;
  if (status !== "signedIn") return <SignInPrompt reason="Sign in to see order updates and replies." />;
  if (!items) return error ? <Notice text={error} /> : <Loading />;

  const open = async (item: NotificationItem) => {
    if (!item.read) {
      await request("/api/mobile/notifications", { method: "POST", body: { ids: [item.id] } }).catch(() => undefined);
      setItems((current) => current?.map((row) => (row.id === item.id ? { ...row, read: true } : row)) ?? null);
    }
    const route = appRouteForPath(item.path);
    if (route) router.push(route as never);
    else if (item.webUrl) await openWeb(item.webUrl);
  };

  const unread = items.some((item) => !item.read);
  return (
    <FlatList
      style={{ backgroundColor: palette.bg }}
      data={items}
      keyExtractor={(item) => item.id}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={async () => {
            setRefreshing(true);
            await load();
            setRefreshing(false);
          }}
        />
      }
      ListHeaderComponent={
        unread ? (
          <View style={{ padding: 12 }}>
            <Button
              label="Mark all as read"
              variant="outline"
              onPress={async () => {
                await request("/api/mobile/notifications", { method: "POST", body: {} }).catch(() => undefined);
                await load();
              }}
            />
          </View>
        ) : undefined
      }
      ListEmptyComponent={<Text style={{ color: palette.muted, textAlign: "center", marginTop: 40 }}>Nothing yet.</Text>}
      ItemSeparatorComponent={() => <View style={{ height: 1, backgroundColor: palette.border }} />}
      renderItem={({ item }) => (
        <Pressable accessibilityRole="link" onPress={() => void open(item)} style={{ padding: 14, backgroundColor: palette.card, gap: 4, flexDirection: "row" }}>
          <View style={{ width: 8, height: 8, borderRadius: 4, marginTop: 6, backgroundColor: item.read ? "transparent" : palette.accent }} />
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={{ color: palette.text, fontWeight: item.read ? "400" : "700" }}>{item.title}</Text>
            {item.body ? <Text style={{ color: palette.muted }}>{item.body}</Text> : null}
            <Text style={{ color: palette.muted, fontSize: 12 }}>{timeAgo(item.createdAt)}</Text>
          </View>
        </Pressable>
      )}
    />
  );
}
