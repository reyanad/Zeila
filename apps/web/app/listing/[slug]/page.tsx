import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@marketplace/ui";
import { Gallery } from "@/components/storefront/gallery";
import { JsonLd } from "@/components/storefront/json-ld";
import { ListingGrid, Rating } from "@/components/storefront/listing-card";
import { Markdown } from "@/components/storefront/markdown";
import { ListingPurchase } from "@/components/storefront/listing-purchase";
import { absoluteUrl, siteUrl } from "@/lib/env";
import { countryName, listingImages, purchaseData } from "@/lib/storefront/detail";
import { getFxRates, getViewerCurrency } from "@/lib/storefront/fx";
import { categoryTrail, loadPublicListingBySlug, similarListings } from "@/lib/storefront/listings";

const TYPE_LABEL = { PHYSICAL: "Product", DIGITAL: "Digital download", SERVICE: "Service" } as const;

function major(minor: number): string {
  return (minor / 100).toFixed(2);
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const listing = await loadPublicListingBySlug(slug);
  if (!listing) return { title: "Listing not found" };
  const description = (listing.summary ?? listing.description).replace(/\s+/g, " ").slice(0, 160);
  const cover = listingImages(listing)[0];
  return {
    title: listing.title,
    description,
    alternates: { canonical: siteUrl(`/listing/${listing.slug}`) },
    openGraph: {
      title: listing.title,
      description,
      url: siteUrl(`/listing/${listing.slug}`),
      type: "website",
      images: cover ? [{ url: absoluteUrl(cover.url), alt: cover.alt || listing.title }] : undefined,
    },
  };
}

export default async function ListingPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const listing = await loadPublicListingBySlug(slug);
  if (!listing) notFound();

  const [fx, viewerCurrency, trail, similar] = await Promise.all([
    getFxRates(),
    getViewerCurrency(),
    listing.category ? categoryTrail(listing.category.path) : Promise.resolve([]),
    similarListings({ id: listing.id, categoryId: listing.categoryId }),
  ]);
  const images = listingImages(listing);
  const data = purchaseData(listing);
  const inStock = data?.type !== "PHYSICAL" || data.skus.some((sku) => sku.available > 0);
  const url = siteUrl(`/listing/${listing.slug}`);

  const jsonLd: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": listing.type === "SERVICE" ? "Service" : "Product",
    name: listing.title,
    description: (listing.summary ?? listing.description).slice(0, 500),
    url,
    image: images.map((image) => absoluteUrl(image.url)),
    [listing.type === "SERVICE" ? "provider" : "brand"]: { "@type": "Organization", name: listing.store.name },
    offers: {
      "@type": "AggregateOffer",
      priceCurrency: listing.currency,
      lowPrice: major(listing.minPrice),
      highPrice: major(listing.maxPrice),
      availability: inStock ? "https://schema.org/InStock" : "https://schema.org/OutOfStock",
      url,
    },
    ...(listing.ratingCount > 0
      ? { aggregateRating: { "@type": "AggregateRating", ratingValue: Number(listing.ratingAvg).toFixed(1), reviewCount: listing.ratingCount } }
      : {}),
  };

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-10 px-4 py-8">
      <JsonLd data={jsonLd} />
      <nav aria-label="Breadcrumb" className="text-sm text-muted-foreground">
        <ol className="flex flex-wrap gap-1">
          <li>
            <Link href="/" className="hover:underline">
              Home
            </Link>
          </li>
          {trail.map((crumb) => (
            <li key={crumb.slug} className="before:mr-1 before:content-['›']">
              <Link href={`/c/${crumb.slug}`} className="hover:underline">
                {crumb.name}
              </Link>
            </li>
          ))}
        </ol>
      </nav>

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_24rem]">
        <div className="flex flex-col gap-8">
          <Gallery images={images} title={listing.title} />
          <section aria-labelledby="about-heading" className="flex flex-col gap-3">
            <h2 id="about-heading" className="text-lg font-semibold">
              About this {listing.type === "SERVICE" ? "service" : listing.type === "DIGITAL" ? "download" : "product"}
            </h2>
            <Markdown>{listing.description}</Markdown>
            {listing.type === "DIGITAL" && listing.digitalAsset?.changelog ? (
              <details className="rounded-md border border-border p-3 text-sm">
                <summary className="cursor-pointer font-medium">What&apos;s new in version {listing.digitalAsset.version}</summary>
                <div className="mt-2">
                  <Markdown>{listing.digitalAsset.changelog}</Markdown>
                </div>
              </details>
            ) : null}
            {listing.tags.length > 0 ? (
              <ul className="flex flex-wrap gap-2" aria-label="Tags">
                {listing.tags.map((tag) => (
                  <li key={tag}>
                    <Link href={`/search?q=${encodeURIComponent(tag)}`} className="rounded-full bg-muted px-3 py-1 text-xs hover:bg-accent">
                      {tag}
                    </Link>
                  </li>
                ))}
              </ul>
            ) : null}
          </section>
        </div>

        <aside className="flex flex-col gap-6 lg:sticky lg:top-6 lg:self-start">
          <div className="flex flex-col gap-2">
            <Badge tone="neutral" className="self-start">
              {TYPE_LABEL[listing.type]}
            </Badge>
            <h1 className="text-2xl font-semibold leading-tight tracking-tight">{listing.title}</h1>
            <Rating average={Number(listing.ratingAvg)} count={listing.ratingCount} />
            {listing.summary ? <p className="text-sm text-muted-foreground">{listing.summary}</p> : null}
          </div>
          <div className="rounded-lg border border-border p-4">
            {data ? <ListingPurchase listingId={listing.id} data={data} viewerCurrency={viewerCurrency} fx={fx} /> : <p className="text-sm">Not available right now.</p>}
          </div>
          <div className="flex flex-col gap-1 rounded-lg border border-border p-4 text-sm">
            <span className="text-xs text-muted-foreground">Sold by</span>
            <Link href={`/store/${listing.store.slug}`} className="font-medium hover:underline">
              {listing.store.name}
            </Link>
            <span className="text-muted-foreground">
              {countryName(listing.store.country)} · selling since {listing.store.createdAt.getFullYear()}
            </span>
          </div>
        </aside>
      </div>

      {similar.length > 0 ? (
        <section aria-labelledby="similar-heading" className="flex flex-col gap-4">
          <h2 id="similar-heading" className="text-xl font-semibold tracking-tight">
            You might also like
          </h2>
          <ListingGrid listings={similar} viewerCurrency={viewerCurrency} fx={fx} />
        </section>
      ) : null}
    </div>
  );
}
