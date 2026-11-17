import type { MetadataRoute } from "next";
import { prisma } from "@marketplace/database";
import { publicListingWhere } from "@marketplace/search";
import { siteUrl } from "@/lib/env";

export const dynamic = "force-dynamic";

const MAX_LISTINGS = 45_000;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const [listings, categories, stores] = await Promise.all([
    prisma.listing.findMany({
      where: publicListingWhere,
      orderBy: { updatedAt: "desc" },
      take: MAX_LISTINGS,
      select: { slug: true, updatedAt: true },
    }),
    prisma.category.findMany({ where: { isActive: true }, select: { slug: true } }),
    prisma.store.findMany({ where: { status: "ACTIVE", vacationMode: false }, select: { slug: true, updatedAt: true } }),
  ]);
  return [
    { url: siteUrl("/"), changeFrequency: "daily", priority: 1 },
    ...categories.map((category) => ({ url: siteUrl(`/c/${category.slug}`), changeFrequency: "daily" as const, priority: 0.7 })),
    ...stores.map((store) => ({ url: siteUrl(`/store/${store.slug}`), lastModified: store.updatedAt, priority: 0.5 })),
    ...listings.map((listing) => ({ url: siteUrl(`/listing/${listing.slug}`), lastModified: listing.updatedAt, priority: 0.8 })),
  ];
}
