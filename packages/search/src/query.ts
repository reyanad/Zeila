import type { Meilisearch } from "meilisearch";
import { prisma, type Prisma } from "@marketplace/database";
import { LISTINGS_INDEX } from "./client";
import { coverImageKey, listingInStock, type ListingDocument } from "./documents";
import { publicListingWhere } from "./visibility";

export const SEARCH_SORTS = ["relevance", "newest", "price-asc", "price-desc", "rating", "popular"] as const;
export type SearchSort = (typeof SEARCH_SORTS)[number];

export interface SearchParams {
  q: string;
  type?: ListingDocument["type"];
  /** Category slug; includes listings in its subcategories. */
  category?: string;
  storeSlug?: string;
  /** Bounds on `sortPrice` (USD minor units when FX rates exist). */
  minPrice?: number;
  maxPrice?: number;
  inStock?: boolean;
  sort: SearchSort;
  page: number;
  pageSize: number;
}

/** What a listing card needs; produced by both search engines. */
export interface ListingCard {
  id: string;
  slug: string;
  type: ListingDocument["type"];
  title: string;
  summary: string;
  storeName: string;
  storeSlug: string;
  currency: string;
  minPrice: number;
  maxPrice: number;
  coverImageKey: string | null;
  ratingAvg: number;
  ratingCount: number;
  inStock: boolean;
  deliveryDays: number | null;
}

export interface SearchResult {
  hits: ListingCard[];
  total: number;
  page: number;
  pageSize: number;
  engine: "meilisearch" | "database";
}

function quote(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

const MEILI_SORT: Record<SearchSort, string[] | undefined> = {
  relevance: undefined,
  newest: ["publishedAt:desc"],
  "price-asc": ["sortPrice:asc"],
  "price-desc": ["sortPrice:desc"],
  rating: ["ratingAvg:desc"],
  popular: ["salesCount:desc"],
};

function toCard(document: ListingDocument): ListingCard {
  return {
    id: document.id,
    slug: document.slug,
    type: document.type,
    title: document.title,
    summary: document.summary,
    storeName: document.storeName,
    storeSlug: document.storeSlug,
    currency: document.currency,
    minPrice: document.minPrice,
    maxPrice: document.maxPrice,
    coverImageKey: document.coverImageKey,
    ratingAvg: document.ratingAvg,
    ratingCount: document.ratingCount,
    inStock: document.inStock,
    deliveryDays: document.deliveryDays,
  };
}

async function searchMeilisearch(client: Meilisearch, params: SearchParams): Promise<SearchResult> {
  const filter: string[] = [];
  if (params.type) filter.push(`type = ${quote(params.type)}`);
  if (params.category) filter.push(`categorySlugs = ${quote(params.category)}`);
  if (params.storeSlug) filter.push(`storeSlug = ${quote(params.storeSlug)}`);
  if (params.minPrice !== undefined) filter.push(`sortPrice >= ${Math.floor(params.minPrice)}`);
  if (params.maxPrice !== undefined) filter.push(`sortPrice <= ${Math.ceil(params.maxPrice)}`);
  if (params.inStock) filter.push("inStock = true");

  const response = await client.index<ListingDocument>(LISTINGS_INDEX).search(params.q, {
    filter,
    sort: MEILI_SORT[params.sort],
    page: params.page,
    hitsPerPage: params.pageSize,
  });
  return {
    hits: response.hits.map(toCard),
    total: response.totalHits ?? response.hits.length,
    page: params.page,
    pageSize: params.pageSize,
    engine: "meilisearch",
  };
}

const cardSelect = {
  id: true,
  slug: true,
  type: true,
  title: true,
  summary: true,
  currency: true,
  minPrice: true,
  maxPrice: true,
  images: true,
  ratingAvg: true,
  ratingCount: true,
  store: { select: { name: true, slug: true } },
  skus: { where: { isActive: true }, select: { inventory: { select: { onHand: true, reserved: true } } } },
  serviceTiers: { where: { isActive: true }, select: { deliveryDays: true } },
  digitalAsset: { select: { id: true } },
} satisfies Prisma.ListingSelect;

export type ListingCardRow = Prisma.ListingGetPayload<{ select: typeof cardSelect }>;
export const listingCardSelect = cardSelect;

export function cardFromRow(row: ListingCardRow): ListingCard {
  const delivery = row.serviceTiers.map((tier) => tier.deliveryDays);
  return {
    id: row.id,
    slug: row.slug,
    type: row.type,
    title: row.title,
    summary: row.summary ?? "",
    storeName: row.store.name,
    storeSlug: row.store.slug,
    currency: row.currency,
    minPrice: row.minPrice,
    maxPrice: row.maxPrice,
    coverImageKey: coverImageKey(row.images),
    ratingAvg: Number(row.ratingAvg),
    ratingCount: row.ratingCount,
    inStock: listingInStock(row),
    deliveryDays: delivery.length > 0 ? Math.min(...delivery) : null,
  };
}

const DB_ORDER: Record<SearchSort, Prisma.ListingOrderByWithRelationInput[]> = {
  relevance: [{ salesCount: "desc" }, { publishedAt: "desc" }],
  newest: [{ publishedAt: "desc" }],
  "price-asc": [{ minPrice: "asc" }],
  "price-desc": [{ minPrice: "desc" }],
  rating: [{ ratingAvg: "desc" }, { ratingCount: "desc" }],
  popular: [{ salesCount: "desc" }],
};

/** Database search: used when Meilisearch is not configured or unavailable. */
export async function searchDatabase(params: SearchParams): Promise<SearchResult> {
  const conditions: Prisma.ListingWhereInput[] = [publicListingWhere];
  if (params.type) conditions.push({ type: params.type });
  if (params.storeSlug) conditions.push({ store: { slug: params.storeSlug } });
  if (params.minPrice !== undefined) conditions.push({ minPrice: { gte: params.minPrice } });
  if (params.maxPrice !== undefined) conditions.push({ minPrice: { lte: params.maxPrice } });
  if (params.category) {
    const category = await prisma.category.findUnique({ where: { slug: params.category }, select: { path: true } });
    if (!category) return { hits: [], total: 0, page: params.page, pageSize: params.pageSize, engine: "database" };
    conditions.push({ OR: [{ category: { path: category.path } }, { category: { path: { startsWith: `${category.path}/` } } }] });
  }
  const q = params.q.trim();
  if (q.length > 0) {
    conditions.push({
      OR: [
        { title: { contains: q, mode: "insensitive" } },
        { summary: { contains: q, mode: "insensitive" } },
        { tags: { has: q.toLowerCase() } },
        { store: { name: { contains: q, mode: "insensitive" } } },
      ],
    });
  }
  const where: Prisma.ListingWhereInput = { AND: conditions };
  const [total, rows] = await Promise.all([
    prisma.listing.count({ where }),
    prisma.listing.findMany({
      where,
      orderBy: DB_ORDER[params.sort],
      skip: (params.page - 1) * params.pageSize,
      take: params.pageSize,
      select: cardSelect,
    }),
  ]);
  const hits = rows.map(cardFromRow).filter((card) => !params.inStock || card.inStock);
  return { hits, total, page: params.page, pageSize: params.pageSize, engine: "database" };
}

/** Meilisearch when available; the database otherwise (or if Meilisearch errors). */
export async function searchListings(params: SearchParams, client: Meilisearch | null): Promise<SearchResult> {
  if (client) {
    try {
      return await searchMeilisearch(client, params);
    } catch (error) {
      console.error("[search] Meilisearch query failed, using the database", error);
    }
  }
  return searchDatabase(params);
}
