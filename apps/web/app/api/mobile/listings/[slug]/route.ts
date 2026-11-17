import { json } from "@/lib/mobile/auth";
import { absoluteUrl } from "@/lib/env";
import { dealsFor, withDeal } from "@/lib/storefront/deals";
import { listingImages, purchaseData } from "@/lib/storefront/detail";
import { loadPublicListingBySlug } from "@/lib/storefront/listings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Listing detail; buying happens in the secure web checkout (`webUrl`). */
export async function GET(_request: Request, { params }: { params: Promise<{ slug: string }> }): Promise<Response> {
  const { slug } = await params;
  const listing = await loadPublicListingBySlug(slug);
  if (!listing) return json({ error: "Not found" }, 404);
  const deals = await dealsFor([listing.id]);
  const base = purchaseData(listing);
  return json({
    id: listing.id,
    slug: listing.slug,
    type: listing.type,
    title: listing.title,
    summary: listing.summary,
    description: listing.description,
    currency: listing.currency,
    minPrice: listing.minPrice,
    maxPrice: listing.maxPrice,
    rating: Number(listing.ratingAvg),
    ratingCount: listing.ratingCount,
    images: listingImages(listing).map((image) => image.url),
    store: { id: listing.store.id, name: listing.store.name, slug: listing.store.slug, country: listing.store.country },
    deal: deals[listing.id] ?? null,
    purchase: base ? withDeal(base, deals[listing.id]) : null,
    webUrl: absoluteUrl(`/listing/${listing.slug}`),
  });
}
