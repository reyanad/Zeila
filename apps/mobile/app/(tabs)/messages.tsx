import { router, useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { FlatList, Pressable, RefreshControl, Text, View } from "react-native";
import { ApiError, type ConversationSummary } from "@/api";
import { useAuth } from "@/auth";
import { timeAgo } from "@/format";
import { SignInPrompt } from "@/sign-in-prompt";
import { Loading, Notice, usePalette } from "@/ui";

export default function MessagesScreen() {
  const palette = usePalette();
  const { status, request } = useAuth();
  const [items, setItems] = useState<ConversationSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      setItems((await request<{ items: ConversationSummary[] }>("/api/mobile/conversations")).items);
      setError(null);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Could not load messages.");
    }
  }, [request]);

  useFocusEffect(
    useCallback(() => {
      if (status === "signedIn") void load();
    }, [status, load]),
  );

  if (status === "loading") return <Loading />;
  if (status !== "signedIn") return <SignInPrompt reason="Sign in to message sellers and buyers." />;
  if (!items) return error ? <Notice text={error} /> : <Loading />;

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
      ListEmptyComponent={<Text style={{ color: palette.muted, textAlign: "center", marginTop: 40, paddingHorizontal: 24 }}>No conversations yet. Use “Message the seller” on a listing.</Text>}
      ItemSeparatorComponent={() => <View style={{ height: 1, backgroundColor: palette.border }} />}
      renderItem={({ item }) => (
        <Pressable accessibilityRole="link" onPress={() => router.push(`/conversation/${item.id}`)} style={{ padding: 14, backgroundColor: palette.card, gap: 4 }}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 8 }}>
            <Text style={{ color: palette.text, fontWeight: item.unread ? "700" : "500", flexShrink: 1 }}>{item.title}</Text>
            <Text style={{ color: palette.muted, fontSize: 12 }}>{timeAgo(item.updatedAt)}</Text>
          </View>
          <Text numberOfLines={1} style={{ color: item.unread ? palette.text : palette.muted }}>
            {item.unread ? "● " : ""}
            {item.preview || "No messages yet"}
          </Text>
        </Pressable>
      )}
    />
  );
}
