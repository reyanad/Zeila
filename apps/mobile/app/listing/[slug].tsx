import { router, Stack, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { Image, ScrollView, Text, useWindowDimensions, View } from "react-native";
import { api, ApiError, type ListingDetail } from "@/api";
import { useAuth } from "@/auth";
import { plainText, priceRange } from "@/format";
import { openWeb } from "@/links";
import { Body, Button, Card, Loading, Notice, Title, usePalette } from "@/ui";

const TYPE_LABEL = { PHYSICAL: "Product", DIGITAL: "Download", SERVICE: "Service" } as const;

export default function ListingScreen() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const palette = usePalette();
  const { width } = useWindowDimensions();
  const { status, request } = useAuth();
  const [listing, setListing] = useState<ListingDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [contacting, setContacting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api<ListingDetail>(`/api/mobile/listings/${encodeURIComponent(slug ?? "")}`)
      .then((value) => {
        if (!cancelled) setListing(value);
      })
      .catch((caught: unknown) => {
        if (!cancelled) setError(caught instanceof ApiError ? caught.message : "Could not load this listing.");
      });
    return () => {
      cancelled = true;
    };
  }, [slug]);

  if (error) return <Notice text={error} />;
  if (!listing) return <Loading />;

  const contact = async () => {
    if (status !== "signedIn") {
      router.push("/login");
      return;
    }
    setContacting(true);
    try {
      const result = await request<{ id: string }>("/api/mobile/conversations", { method: "POST", body: { storeId: listing.store.id, listingId: listing.id } });
      router.push(`/conversation/${result.id}`);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Could not open the conversation.");
    } finally {
      setContacting(false);
    }
  };

  return (
    <ScrollView style={{ flex: 1, backgroundColor: palette.bg }} contentContainerStyle={{ paddingBottom: 32 }}>
      <Stack.Screen options={{ title: TYPE_LABEL[listing.type] }} />
      <ScrollView horizontal pagingEnabled showsHorizontalScrollIndicator={false}>
        {(listing.images.length > 0 ? listing.images : [null]).map((url, index) => (
          <View key={url ?? `empty-${index}`} style={{ width, aspectRatio: 4 / 3, backgroundColor: palette.border }}>
            {url ? <Image source={{ uri: url }} style={{ width: "100%", height: "100%" }} resizeMode="cover" accessibilityLabel={`${listing.title}, photo ${index + 1}`} /> : null}
          </View>
        ))}
      </ScrollView>
      <View style={{ padding: 16, gap: 12 }}>
        <Title>{listing.title}</Title>
        <Body muted>
          {listing.store.name}
          {listing.ratingCount > 0 ? ` · ★ ${listing.rating.toFixed(1)} (${listing.ratingCount})` : ""}
        </Body>
        <Text style={{ fontSize: 20, fontWeight: "700", color: palette.text }}>{priceRange(listing.minPrice, listing.maxPrice, listing.currency, listing.deal?.discountBps ?? 0)}</Text>
        {listing.deal ? (
          <Card style={{ borderColor: palette.danger }}>
            <Text style={{ color: palette.danger, fontWeight: "600" }}>
              {listing.deal.name}: {Math.round(listing.deal.discountBps / 100)}% off until {new Date(listing.deal.endsAt).toLocaleString()}
            </Text>
          </Card>
        ) : null}
        {listing.summary ? <Body>{listing.summary}</Body> : null}
        <Button label="Buy securely" onPress={() => void openWeb(listing.webUrl)} />
        <Button label="Message the seller" variant="outline" loading={contacting} onPress={() => void contact()} />
        <Body muted>Payment is held in escrow and released to the seller only after you receive what you ordered.</Body>
        <Body>{plainText(listing.description)}</Body>
      </View>
    </ScrollView>
  );
}
