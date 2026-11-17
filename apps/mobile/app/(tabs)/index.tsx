import { router } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { FlatList, Image, Pressable, RefreshControl, ScrollView, Text, TextInput, View } from "react-native";
import { api, ApiError, type ListingCard, type ListingPage } from "@/api";
import { priceRange } from "@/format";
import { Notice, styles, usePalette } from "@/ui";

const TYPES = [
  { value: "", label: "All" },
  { value: "PHYSICAL", label: "Products" },
  { value: "DIGITAL", label: "Downloads" },
  { value: "SERVICE", label: "Services" },
] as const;

export default function BrowseScreen() {
  const palette = usePalette();
  const [query, setQuery] = useState("");
  const [type, setType] = useState<string>("");
  const [items, setItems] = useState<ListingCard[]>([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestId = useRef(0);

  const load = useCallback(async (nextPage: number, replace: boolean) => {
    const id = ++requestId.current;
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ page: String(nextPage) });
      if (query.trim()) params.set("q", query.trim());
      if (type) params.set("type", type);
      const result = await api<ListingPage>(`/api/mobile/listings?${params.toString()}`);
      if (id !== requestId.current) return;
      setItems((current) => (replace ? result.items : [...current, ...result.items]));
      setPage(result.page);
      setHasMore(result.hasMore);
    } catch (caught) {
      if (id === requestId.current) setError(caught instanceof ApiError ? caught.message : "Could not load listings.");
    } finally {
      if (id === requestId.current) setLoading(false);
    }
  }, [query, type]);

  useEffect(() => {
    const timer = setTimeout(() => void load(1, true), 300);
    return () => clearTimeout(timer);
  }, [load]);

  return (
    <View style={{ flex: 1, backgroundColor: palette.bg }}>
      <View style={{ padding: 12, gap: 10 }}>
        <TextInput
          accessibilityLabel="Search"
          placeholder="Search products, downloads and services"
          placeholderTextColor={palette.muted}
          value={query}
          onChangeText={setQuery}
          returnKeyType="search"
          style={[styles.input, { color: palette.text, borderColor: palette.border, backgroundColor: palette.card }]}
        />
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
          {TYPES.map((option) => (
            <Pressable
              key={option.value}
              accessibilityRole="button"
              accessibilityState={{ selected: type === option.value }}
              onPress={() => setType(option.value)}
              style={{ paddingHorizontal: 14, paddingVertical: 6, borderRadius: 999, backgroundColor: type === option.value ? palette.primary : palette.card, borderWidth: 1, borderColor: palette.border }}
            >
              <Text style={{ color: type === option.value ? palette.primaryText : palette.text }}>{option.label}</Text>
            </Pressable>
          ))}
        </ScrollView>
        {error ? <Notice text={error} /> : null}
      </View>
      <FlatList
        data={items}
        keyExtractor={(item) => item.id}
        numColumns={2}
        columnWrapperStyle={{ gap: 12, paddingHorizontal: 12 }}
        contentContainerStyle={{ gap: 12, paddingBottom: 24 }}
        refreshControl={<RefreshControl refreshing={loading && page === 1} onRefresh={() => void load(1, true)} />}
        onEndReachedThreshold={0.5}
        onEndReached={() => {
          if (hasMore && !loading) void load(page + 1, false);
        }}
        ListEmptyComponent={!loading ? <Text style={{ color: palette.muted, textAlign: "center", marginTop: 40 }}>Nothing found.</Text> : undefined}
        renderItem={({ item }) => (
          <Pressable accessibilityRole="link" onPress={() => router.push(`/listing/${item.slug}`)} style={{ flex: 1, maxWidth: "50%" }}>
            <View style={{ borderRadius: 12, overflow: "hidden", backgroundColor: palette.card, borderWidth: 1, borderColor: palette.border }}>
              <View style={{ aspectRatio: 4 / 3, backgroundColor: palette.border }}>
                {item.imageUrl ? <Image source={{ uri: item.imageUrl }} style={{ width: "100%", height: "100%" }} resizeMode="cover" accessibilityIgnoresInvertColors /> : null}
                {item.deal ? (
                  <Text style={{ position: "absolute", top: 6, right: 6, backgroundColor: palette.danger, color: "#ffffff", fontWeight: "700", fontSize: 12, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6, overflow: "hidden" }}>
                    −{Math.round(item.deal.discountBps / 100)}%
                  </Text>
                ) : null}
              </View>
              <View style={{ padding: 10, gap: 2 }}>
                <Text numberOfLines={2} style={{ color: palette.text, fontWeight: "500" }}>
                  {item.title}
                </Text>
                <Text numberOfLines={1} style={{ color: palette.muted, fontSize: 12 }}>
                  {item.storeName}
                </Text>
                <Text style={{ color: palette.text, fontWeight: "600", marginTop: 4 }}>{priceRange(item.minPrice, item.maxPrice, item.currency, item.deal?.discountBps ?? 0)}</Text>
                {item.ratingCount > 0 ? <Text style={{ color: palette.muted, fontSize: 12 }}>★ {item.rating.toFixed(1)} ({item.ratingCount})</Text> : null}
                {!item.inStock ? <Text style={{ color: palette.danger, fontSize: 12 }}>Out of stock</Text> : null}
              </View>
            </View>
          </Pressable>
        )}
      />
    </View>
  );
}
