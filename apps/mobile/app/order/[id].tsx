import { Stack, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { Alert, Linking, ScrollView, Text, View } from "react-native";
import { ApiError, type OrderDetail } from "@/api";
import { useAuth } from "@/auth";
import { money, shortDate, statusLabel } from "@/format";
import { openWeb } from "@/links";
import { SignInPrompt } from "@/sign-in-prompt";
import { Badge, Body, Button, Card, Loading, Notice, usePalette } from "@/ui";

export default function OrderScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const palette = usePalette();
  const { status, request } = useAuth();
  const [order, setOrder] = useState<OrderDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setOrder(await request<OrderDetail>(`/api/mobile/orders/${encodeURIComponent(id ?? "")}`));
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Could not load the order.");
    }
  }, [id, request]);

  useEffect(() => {
    if (status === "signedIn") void load();
  }, [status, load]);

  if (status === "loading") return <Loading />;
  if (status !== "signedIn") return <SignInPrompt reason="Sign in to see this order." />;
  if (!order) return error ? <Notice text={error} /> : <Loading />;

  const confirm = (subOrderId: string, storeName: string) =>
    Alert.alert("Confirm you received it?", `${storeName} is paid from escrow straight away. Only confirm if everything arrived as described.`, [
      { text: "Not yet", style: "cancel" },
      {
        text: "Yes, release payment",
        onPress: async () => {
          setBusy(subOrderId);
          try {
            await request(`/api/mobile/orders/${order.id}/confirm`, { method: "POST", body: { subOrderId } });
            await load();
          } catch (caught) {
            setError(caught instanceof ApiError ? caught.message : "Could not confirm.");
          } finally {
            setBusy(null);
          }
        },
      },
    ]);

  return (
    <ScrollView style={{ flex: 1, backgroundColor: palette.bg }} contentContainerStyle={{ padding: 16, gap: 12 }}>
      <Stack.Screen options={{ title: order.orderNumber }} />
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
        <Body muted>Placed {shortDate(order.placedAt)}</Body>
        <Badge label={statusLabel(order.status)} tone="info" />
      </View>
      {error ? <Notice text={error} /> : null}
      {order.subOrders.map((subOrder) => (
        <Card key={subOrder.id}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
            <Text style={{ color: palette.text, fontWeight: "600", flexShrink: 1 }}>{subOrder.storeName}</Text>
            <Badge label={statusLabel(subOrder.status)} tone={subOrder.status === "COMPLETED" ? "success" : "info"} />
          </View>
          {subOrder.items.map((item) => (
            <View key={item.id} style={{ flexDirection: "row", justifyContent: "space-between", gap: 8 }}>
              <Text style={{ color: palette.text, flex: 1 }}>
                {item.quantity} × {item.title}
              </Text>
              <Text style={{ color: palette.text }}>{money(item.total, order.currency)}</Text>
            </View>
          ))}
          {subOrder.shipments.map((shipment, index) => (
            <Text
              key={`${shipment.trackingNumber ?? "local"}-${index}`}
              style={{ color: shipment.trackingUrl ? palette.accent : palette.muted }}
              onPress={shipment.trackingUrl ? () => void Linking.openURL(shipment.trackingUrl ?? "") : undefined}
            >
              {statusLabel(shipment.status)} · {shipment.carrier}
              {shipment.trackingNumber ? ` ${shipment.trackingNumber}` : ""}
            </Text>
          ))}
          {subOrder.escrow ? (
            <Body muted>
              {statusLabel(subOrder.escrow.status)}
              {subOrder.escrow.status === "HELD" ? ` until ${shortDate(subOrder.escrow.holdUntil)}` : ""}
            </Body>
          ) : null}
          {subOrder.items
            .filter((item) => item.workspaceUrl)
            .map((item) => (
              <Button key={`work-${item.id}`} label={`Open workspace: ${item.title}`} variant="outline" onPress={() => void openWeb(item.workspaceUrl ?? "")} />
            ))}
          {subOrder.canConfirm ? <Button label="I received it" loading={busy === subOrder.id} onPress={() => confirm(subOrder.id, subOrder.storeName)} /> : null}
        </Card>
      ))}
      <Text style={{ color: palette.text, fontWeight: "700", fontSize: 18 }}>Total {money(order.total, order.currency)}</Text>
      <Button label="Returns, reviews and help" variant="outline" onPress={() => void openWeb(order.webUrl)} />
    </ScrollView>
  );
}
