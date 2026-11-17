import type { Metadata } from "next";
import Link from "next/link";
import { prisma } from "@marketplace/database";
import { formatMoney, type CurrencyCode } from "@marketplace/shared-types";
import { Alert, Badge, buttonVariants } from "@marketplace/ui";
import { STATUS_BADGE } from "@/components/studio/listing-builder";
import { ListingRowActions } from "@/components/studio/listing-row-actions";
import { requireStudio } from "@/lib/studio/context";

export const metadata: Metadata = { title: "Vendor Studio" };

const TYPE_LABEL = { PHYSICAL: "Product", DIGITAL: "Digital", SERVICE: "Service" } as const;

export default async function StudioPage() {
  const { store } = await requireStudio("/seller/studio");
  const listings = await prisma.listing.findMany({
    where: { storeId: store.id, status: { not: "ARCHIVED" } },
    orderBy: { updatedAt: "desc" },
    take: 200,
    select: { id: true, title: true, type: true, status: true, minPrice: true, maxPrice: true, currency: true, updatedAt: true, salesCount: true },
  });
  const price = (amount: number, currency: string) => formatMoney({ amount, currency: currency as CurrencyCode });

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">Listings</h1>
        <Link href="/seller/studio/listings/new" className={buttonVariants()}>
          New listing
        </Link>
      </div>
      {store.status !== "ACTIVE" ? (
        <Alert tone="info">
          Your store is not active yet, so listings stay unpublished.{" "}
          <Link href="/seller/onboarding" className="font-medium underline underline-offset-4">
            Finish seller setup
          </Link>
        </Alert>
      ) : null}
      {listings.length === 0 ? (
        <div className="rounded-md border border-dashed border-border p-10 text-center">
          <p className="font-medium">No listings yet</p>
          <p className="mt-1 text-sm text-muted-foreground">Sell physical products, digital downloads or your services.</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-md border border-border">
          <table className="w-full min-w-[40rem] text-sm">
            <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
              <tr>
                <th scope="col" className="p-3 font-medium">Listing</th>
                <th scope="col" className="p-3 font-medium">Type</th>
                <th scope="col" className="p-3 font-medium">Price</th>
                <th scope="col" className="p-3 font-medium">Sales</th>
                <th scope="col" className="p-3 font-medium">Status</th>
                <th scope="col" className="p-3 font-medium"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {listings.map((listing) => (
                <tr key={listing.id} className="border-t border-border align-top">
                  <td className="p-3">
                    <Link href={`/seller/studio/listings/${listing.id}`} className="font-medium hover:underline">
                      {listing.title}
                    </Link>
                    <p className="text-xs text-muted-foreground">Updated {listing.updatedAt.toLocaleDateString("en-GB", { dateStyle: "medium" })}</p>
                  </td>
                  <td className="p-3">{TYPE_LABEL[listing.type]}</td>
                  <td className="p-3 tabular-nums">
                    {listing.minPrice === listing.maxPrice
                      ? price(listing.minPrice, listing.currency)
                      : `${price(listing.minPrice, listing.currency)} – ${price(listing.maxPrice, listing.currency)}`}
                  </td>
                  <td className="p-3 tabular-nums">{listing.salesCount}</td>
                  <td className="p-3">
                    <Badge tone={STATUS_BADGE[listing.status].tone}>{STATUS_BADGE[listing.status].label}</Badge>
                  </td>
                  <td className="p-3">
                    <ListingRowActions listingId={listing.id} status={listing.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
