import { prisma, type Prisma } from "@marketplace/database";
import { convertMinor, type FxRates } from "@marketplace/shared-types";
import { publicListingWhere } from "./visibility";

/** Shape of a listing in the Meilisearch `listings` index. */
export interface ListingDocument {
  id: string;
  slug: string;
  type: "PHYSICAL" | "DIGITAL" | "SERVICE";
  title: string;
  summary: string;
  description: string;
  tags: string[];
  categorySlugs: string[];
  storeId: string;
  storeName: string;
  storeSlug: string;
  storeCountry: string;
  currency: string;
  minPrice: number;
  maxPrice: number;
  /** Lowest price in USD minor units for cross-currency sorting; native price when no FX rates exist. */
  sortPrice: number;
  coverImageKey: string | null;
  ratingAvg: number;
  ratingCount: number;
  salesCount: number;
  inStock: boolean;
  /** Fastest service delivery in days, when the listing is a service. */
  deliveryDays: number | null;
  publishedAt: number;
}

export const listingIndexInclude = {
  store: { select: { id: true, name: true, slug: true, country: true, status: true, vacationMode: true } },
  category: { select: { path: true } },
  skus: { where: { isActive: true }, select: { inventory: { select: { onHand: true, reserved: true } } } },
  serviceTiers: { where: { isActive: true }, select: { deliveryDays: true } },
  digitalAsset: { select: { id: true } },
} satisfies Prisma.ListingInclude;

export type ListingForIndex = Prisma.ListingGetPayload<{ include: typeof listingIndexInclude }>;

export function coverImageKey(images: Prisma.JsonValue): string | null {
  if (!Array.isArray(images)) return null;
  const first = images[0];
  if (typeof first !== "object" || first === null || Array.isArray(first)) return null;
  const key = (first as Record<string, unknown>).key;
  return typeof key === "string" ? key : null;
}

export function listingInStock(listing: Pick<ListingForIndex, "type" | "skus" | "digitalAsset">): boolean {
  if (listing.type === "PHYSICAL") {
    return listing.skus.some((sku) => sku.inventory.reduce((sum, level) => sum + level.onHand - level.reserved, 0) > 0);
  }
  if (listing.type === "DIGITAL") return listing.digitalAsset !== null;
  return true;
}

export function buildListingDocument(listing: ListingForIndex, fx: FxRates | null): ListingDocument {
  const usd = convertMinor(listing.minPrice, listing.currency, "USD", fx);
  const delivery = listing.serviceTiers.map((tier) => tier.deliveryDays);
  return {
    id: listing.id,
    slug: listing.slug,
    type: listing.type,
    title: listing.title,
    summary: listing.summary ?? "",
    description: listing.description.slice(0, 4_000),
    tags: listing.tags,
    categorySlugs: listing.category ? listing.category.path.split("/") : [],
    storeId: listing.store.id,
    storeName: listing.store.name,
    storeSlug: listing.store.slug,
    storeCountry: listing.store.country,
    currency: listing.currency,
    minPrice: listing.minPrice,
    maxPrice: listing.maxPrice,
    sortPrice: usd ?? listing.minPrice,
    coverImageKey: coverImageKey(listing.images),
    ratingAvg: Number(listing.ratingAvg),
    ratingCount: listing.ratingCount,
    salesCount: listing.salesCount,
    inStock: listingInStock(listing),
    deliveryDays: delivery.length > 0 ? Math.min(...delivery) : null,
    publishedAt: Math.floor((listing.publishedAt ?? listing.updatedAt).getTime() / 1000),
  };
}

/** The listing if it should be searchable, otherwise null (it must be removed from the index). */
export async function loadPublicListing(listingId: string): Promise<ListingForIndex | null> {
  return prisma.listing.findFirst({ where: { id: listingId, ...publicListingWhere }, include: listingIndexInclude });
}
