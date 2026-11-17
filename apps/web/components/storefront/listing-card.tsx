import Link from "next/link";
import { discountedUnitPrice, type FxRates } from "@marketplace/shared-types";
import type { ListingCard as Card } from "@marketplace/search";
import { publicAssetUrl } from "@/lib/env";
import { dealsFor, type DealView } from "@/lib/storefront/deals";
import { Price } from "./price";

const TYPE_LABEL = { PHYSICAL: "Product", DIGITAL: "Download", SERVICE: "Service" } as const;

export function Rating({ average, count }: { average: number; count: number }) {
  if (count === 0) return <span className="text-xs text-muted-foreground">No reviews yet</span>;
  return (
    <span className="text-xs text-muted-foreground" aria-label={`Rated ${average.toFixed(1)} out of 5 from ${count} reviews`}>
      <span aria-hidden className="text-amber-500">★</span> {average.toFixed(1)} ({count})
    </span>
  );
}

export function ListingCard({ listing, viewerCurrency, fx, deal }: { listing: Card; viewerCurrency: string; fx: FxRates | null; deal?: DealView }) {
  const minPrice = deal ? discountedUnitPrice(listing.minPrice, deal.discountBps) : listing.minPrice;
  const maxPrice = deal ? discountedUnitPrice(listing.maxPrice, deal.discountBps) : listing.maxPrice;
  return (
    <article className="group flex flex-col overflow-hidden rounded-lg border border-border bg-card">
      <Link href={`/listing/${listing.slug}`} className="flex flex-1 flex-col focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <div className="relative aspect-[4/3] bg-muted">
          {listing.coverImageKey ? (
            // eslint-disable-next-line @next/next/no-img-element -- storage images are pre-sized WebP
            <img src={publicAssetUrl(listing.coverImageKey)} alt="" loading="lazy" className="h-full w-full object-cover transition-transform group-hover:scale-[1.02]" />
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">{TYPE_LABEL[listing.type]}</div>
          )}
          <span className="absolute left-2 top-2 rounded bg-background/90 px-2 py-0.5 text-xs font-medium">{TYPE_LABEL[listing.type]}</span>
          {deal ? (
            <span className="absolute right-2 top-2 rounded bg-destructive px-2 py-0.5 text-xs font-semibold text-white">−{Math.round(deal.discountBps / 100)}%</span>
          ) : null}
        </div>
        <div className="flex flex-1 flex-col gap-1 p-3">
          <h3 className="line-clamp-2 text-sm font-medium leading-snug">{listing.title}</h3>
          <p className="text-xs text-muted-foreground">{listing.storeName}</p>
          <Rating average={listing.ratingAvg} count={listing.ratingCount} />
          <div className="mt-auto flex items-end justify-between gap-2 pt-2">
            <Price amount={minPrice} maxAmount={maxPrice} currency={listing.currency} viewerCurrency={viewerCurrency} fx={fx} className="text-sm" />
            {!listing.inStock ? <span className="text-xs font-medium text-destructive">Out of stock</span> : null}
            {listing.type === "SERVICE" && listing.deliveryDays !== null ? (
              <span className="text-xs text-muted-foreground">{listing.deliveryDays}-day delivery</span>
            ) : null}
          </div>
        </div>
      </Link>
    </article>
  );
}

/** Grid of cards; live flash sale prices are looked up for the listings shown. */
export async function ListingGrid({ listings, viewerCurrency, fx }: { listings: Card[]; viewerCurrency: string; fx: FxRates | null }) {
  const deals = await dealsFor(listings.map((listing) => listing.id));
  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
      {listings.map((listing) => (
        <ListingCard key={listing.id} listing={listing} viewerCurrency={viewerCurrency} fx={fx} deal={deals[listing.id]} />
      ))}
    </div>
  );
}
