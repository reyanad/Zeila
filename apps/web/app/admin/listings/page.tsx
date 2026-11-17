import type { Metadata } from "next";
import Link from "next/link";
import { getSetting } from "@marketplace/core";
import { prisma, type Prisma } from "@marketplace/database";
import { Badge } from "@marketplace/ui";
import { ListingDecision } from "@/components/admin/listing-decision";
import { formatPrice } from "@/components/storefront/price";
import { requirePermission } from "@/lib/admin";

export const metadata: Metadata = { title: "Listings · Admin", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function ListingModerationPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requirePermission("listing:moderate", "/admin/listings");
  const params = await searchParams;
  const query = typeof params.q === "string" ? params.q.trim().slice(0, 100) : "";
  const reviewMode = await getSetting("listingReviewMode");
  const where: Prisma.ListingWhereInput = query
    ? { OR: [{ title: { contains: query, mode: "insensitive" } }, { store: { name: { contains: query, mode: "insensitive" } } }, { slug: query }], status: { in: ["ACTIVE", "PAUSED", "PENDING_REVIEW"] } }
    : { status: "PENDING_REVIEW" };
  const listings = await prisma.listing.findMany({
    where,
    orderBy: { updatedAt: "asc" },
    take: 50,
    select: {
      id: true,
      title: true,
      slug: true,
      type: true,
      status: true,
      summary: true,
      description: true,
      currency: true,
      minPrice: true,
      maxPrice: true,
      updatedAt: true,
      store: { select: { name: true, slug: true } },
      _count: { select: { fraudFlags: { where: { status: { in: ["OPEN", "REVIEWING"] } } } } },
    },
  });

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-10">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">Listings</h1>
        <p className="text-sm text-muted-foreground">
          Review mode: <strong>{reviewMode === "pre" ? "before publishing" : "after publishing"}</strong> (change in Settings)
        </p>
      </div>
      <form className="flex gap-2" action="/admin/listings">
        <label htmlFor="listing-search" className="sr-only">
          Find a live listing
        </label>
        <input id="listing-search" name="q" defaultValue={query} placeholder="Find a live listing by title, store or slug" className="h-9 flex-1 rounded-md border border-input bg-background px-3 text-sm" />
      </form>
      <p className="text-sm text-muted-foreground">{query ? `Results for “${query}”` : `Waiting for review (${listings.length})`}</p>
      {listings.length === 0 ? (
        <p className="rounded-md border border-dashed border-border p-8 text-center text-sm text-muted-foreground">Nothing here.</p>
      ) : (
        <ul className="flex flex-col gap-4">
          {listings.map((listing) => (
            <li key={listing.id} className="flex flex-col gap-3 rounded-lg border border-border p-4 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-medium">
                  {listing.status === "ACTIVE" ? (
                    <Link href={`/listing/${listing.slug}`} className="hover:underline" target="_blank">
                      {listing.title}
                    </Link>
                  ) : (
                    listing.title
                  )}
                  <span className="ml-2 text-xs font-normal text-muted-foreground">
                    {listing.type.toLowerCase()} · {listing.store.name} · {formatPrice(listing.minPrice, listing.currency)}
                    {listing.maxPrice > listing.minPrice ? `–${formatPrice(listing.maxPrice, listing.currency)}` : ""}
                  </span>
                </span>
                <span className="flex items-center gap-2">
                  {listing._count.fraudFlags > 0 ? <Badge tone="danger">{listing._count.fraudFlags} open flag{listing._count.fraudFlags === 1 ? "" : "s"}</Badge> : null}
                  <Badge tone={listing.status === "PENDING_REVIEW" ? "warning" : "info"}>{listing.status.toLowerCase().replace("_", " ")}</Badge>
                </span>
              </div>
              {listing.summary ? <p>{listing.summary}</p> : null}
              <p className="line-clamp-4 whitespace-pre-wrap text-muted-foreground">{listing.description.slice(0, 800)}</p>
              <ListingDecision listingId={listing.id} pending={listing.status === "PENDING_REVIEW"} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
