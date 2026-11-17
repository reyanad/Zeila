import { SEARCH_SORTS, type SearchSort } from "@marketplace/search";
import { json } from "@/lib/mobile/auth";
import { publicAssetUrl } from "@/lib/env";
import { dealsFor } from "@/lib/storefront/deals";
import { runSearch } from "@/lib/storefront/search";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Public search for the app's browse tab. */
export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const q = (url.searchParams.get("q") ?? "").trim().slice(0, 100);
  const type = url.searchParams.get("type");
  const sortParam = url.searchParams.get("sort") ?? "relevance";
  const sort: SearchSort = (SEARCH_SORTS as readonly string[]).includes(sortParam) ? (sortParam as SearchSort) : "relevance";
  const page = Math.max(1, Math.min(50, Number.parseInt(url.searchParams.get("page") ?? "1", 10) || 1));
  const result = await runSearch({
    q,
    type: type === "PHYSICAL" || type === "DIGITAL" || type === "SERVICE" ? type : undefined,
    sort: q ? sort : sort === "relevance" ? "newest" : sort,
    page,
    pageSize: 20,
  });
  const deals = await dealsFor(result.hits.map((hit) => hit.id));
  return json({
    page: result.page,
    total: result.total,
    hasMore: result.page * result.pageSize < result.total,
    items: result.hits.map((hit) => ({
      id: hit.id,
      slug: hit.slug,
      type: hit.type,
      title: hit.title,
      storeName: hit.storeName,
      currency: hit.currency,
      minPrice: hit.minPrice,
      maxPrice: hit.maxPrice,
      imageUrl: hit.coverImageKey ? publicAssetUrl(hit.coverImageKey) : null,
      rating: hit.ratingAvg,
      ratingCount: hit.ratingCount,
      inStock: hit.inStock,
      deal: deals[hit.id] ?? null,
    })),
  });
}
