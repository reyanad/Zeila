import { router, useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { FlatList, Pressable, RefreshControl, Text, View } from "react-native";
import { ApiError, type OrderSummary } from "@/api";
import { useAuth } from "@/auth";
import { money, shortDate, statusLabel } from "@/format";
import { SignInPrompt } from "@/sign-in-prompt";
import { Badge, Loading, Notice, usePalette } from "@/ui";

export default function OrdersScreen() {
  const palette = usePalette();
  const { status, request } = useAuth();
  const [orders, setOrders] = useState<OrderSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const result = await request<{ items: OrderSummary[] }>("/api/mobile/orders");
      setOrders(result.items);
      setError(null);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Could not load orders.");
    }
  }, [request]);

  useFocusEffect(
    useCallback(() => {
      if (status === "signedIn") void load();
    }, [status, load]),
  );

  if (status === "loading") return <Loading />;
  if (status !== "signedIn") return <SignInPrompt reason="Sign in to see your orders." />;
  if (!orders) return error ? <Notice text={error} /> : <Loading />;

  return (
    <FlatList
      style={{ backgroundColor: palette.bg }}
      data={orders}
      keyExtractor={(order) => order.id}
      contentContainerStyle={{ padding: 12, gap: 10 }}
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
      ListHeaderComponent={error ? <Notice text={error} /> : undefined}
      ListEmptyComponent={<Text style={{ color: palette.muted, textAlign: "center", marginTop: 40 }}>No orders yet.</Text>}
      renderItem={({ item }) => (
        <Pressable accessibilityRole="link" onPress={() => router.push(`/order/${item.id}`)} style={{ backgroundColor: palette.card, borderColor: palette.border, borderWidth: 1, borderRadius: 12, padding: 14, gap: 6 }}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
            <Text style={{ color: palette.text, fontWeight: "600" }}>{item.orderNumber}</Text>
            <Badge label={statusLabel(item.status)} tone={item.status === "COMPLETED" ? "success" : item.status === "CANCELLED" || item.status === "REFUNDED" ? "neutral" : "info"} />
          </View>
          <Text numberOfLines={2} style={{ color: palette.muted }}>
            {item.summary}
          </Text>
          <Text style={{ color: palette.text }}>
            {money(item.total, item.currency)} · {shortDate(item.placedAt)}
          </Text>
        </Pressable>
      )}
    />
  );
}
