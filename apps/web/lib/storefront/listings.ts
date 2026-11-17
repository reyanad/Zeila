import "server-only";
import { cache } from "react";
import { prisma, type Prisma } from "@marketplace/database";
import { cardFromRow, listingCardSelect, publicListingWhere, type ListingCard } from "@marketplace/search";

export const listingDetailInclude = {
  store: {
    select: {
      id: true,
      name: true,
      slug: true,
      tagline: true,
      country: true,
      createdAt: true,
      warehouses: { where: { isDefault: true }, select: { city: true, country: true }, take: 1 },
    },
  },
  category: { select: { id: true, name: true, slug: true, path: true } },
  skus: {
    where: { isActive: true },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      skuCode: true,
      variantValues: true,
      price: true,
      compareAtPrice: true,
      inventory: { select: { onHand: true, reserved: true } },
      wholesaleTiers: { orderBy: { minQty: "asc" }, select: { minQty: true, unitPrice: true } },
    },
  },
  digitalAsset: {
    select: { fileName: true, sizeBytes: true, version: true, changelog: true, licenseTemplate: true, activationsLimit: true, downloadLimit: true, price: true },
  },
  serviceTiers: {
    where: { isActive: true },
    select: { id: true, level: true, title: true, description: true, price: true, deliveryDays: true, revisions: true, features: true },
  },
} satisfies Prisma.ListingInclude;

export type ListingDetail = Prisma.ListingGetPayload<{ include: typeof listingDetailInclude }>;

/** A public listing by slug, or null (drafts, paused listings and inactive stores are hidden). */
export const loadPublicListingBySlug = cache(async (slug: string): Promise<ListingDetail | null> => {
  return prisma.listing.findFirst({ where: { slug, ...publicListingWhere }, include: listingDetailInclude });
});

export interface CategoryCrumb {
  name: string;
  slug: string;
}

/** Ancestors of a category from its materialised path ("fashion/scarves-shawls"). */
export async function categoryTrail(path: string): Promise<CategoryCrumb[]> {
  const slugs = path.split("/");
  const rows = await prisma.category.findMany({ where: { slug: { in: slugs } }, select: { name: true, slug: true } });
  const bySlug = new Map(rows.map((row) => [row.slug, row]));
  return slugs.flatMap((slug) => {
    const row = bySlug.get(slug);
    return row ? [row] : [];
  });
}

/**
 * Listings similar to this one: nearest neighbours by embedding (pgvector,
 * cosine distance) when embeddings exist, otherwise popular listings from the
 * same category, otherwise popular listings overall.
 */
export async function similarListings(listing: { id: string; categoryId: string | null }, limit = 8): Promise<ListingCard[]> {
  let ids: string[] = [];
  try {
    const rows = await prisma.$queryRaw<Array<{ id: string }>>`
      SELECT l."id"
      FROM "Listing" l
      JOIN "Store" s ON s."id" = l."storeId"
      WHERE l."id" <> ${listing.id}
        AND l."status" = 'ACTIVE'
        AND s."status" = 'ACTIVE'
        AND s."vacationMode" = false
        AND l."embedding" IS NOT NULL
        AND EXISTS (SELECT 1 FROM "Listing" t WHERE t."id" = ${listing.id} AND t."embedding" IS NOT NULL)
      ORDER BY l."embedding" <=> (SELECT t."embedding" FROM "Listing" t WHERE t."id" = ${listing.id})
      LIMIT ${limit}`;
    ids = rows.map((row) => row.id);
  } catch (error) {
    console.error("[recommendations] vector query failed", error);
  }

  if (ids.length > 0) {
    const rows = await prisma.listing.findMany({ where: { id: { in: ids }, ...publicListingWhere }, select: listingCardSelect });
    const byId = new Map(rows.map((row) => [row.id, row]));
    return ids.flatMap((id) => {
      const row = byId.get(id);
      return row ? [cardFromRow(row)] : [];
    });
  }

  const rows = await prisma.listing.findMany({
    where: { ...publicListingWhere, id: { not: listing.id }, ...(listing.categoryId ? { categoryId: listing.categoryId } : {}) },
    orderBy: [{ salesCount: "desc" }, { publishedAt: "desc" }],
    take: limit,
    select: listingCardSelect,
  });
  if (rows.length > 0 || !listing.categoryId) return rows.map(cardFromRow);
  return similarListings({ id: listing.id, categoryId: null }, limit);
}

export async function rootCategories(): Promise<Array<{ name: string; slug: string }>> {
  return prisma.category.findMany({
    where: { parentId: null, isActive: true },
    orderBy: { position: "asc" },
    select: { name: true, slug: true },
  });
}

/** Every active category as a search filter option, labelled with its path. */
export async function categoryFilterOptions(): Promise<Array<{ value: string; label: string }>> {
  const categories = await prisma.category.findMany({ where: { isActive: true }, select: { name: true, slug: true, path: true } });
  const nameBySlug = new Map(categories.map((category) => [category.slug, category.name]));
  return categories
    .map((category) => ({
      value: category.slug,
      label: category.path
        .split("/")
        .map((slug) => nameBySlug.get(slug) ?? slug)
        .join(" › "),
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
}
