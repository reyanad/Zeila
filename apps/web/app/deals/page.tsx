import type { Metadata } from "next";
import { prisma } from "@marketplace/database";
import { cardFromRow, listingCardSelect, publicListingWhere } from "@marketplace/search";
import { Countdown } from "@/components/growth/countdown";
import { ListingGrid } from "@/components/storefront/listing-card";
import { getFxRates, getViewerCurrency } from "@/lib/storefront/fx";

export const metadata: Metadata = { title: "Flash deals", description: "Time-limited discounts from sellers across Zeila." };
export const dynamic = "force-dynamic";

export default async function DealsPage() {
  const now = new Date();
  const [sales, fx, viewerCurrency] = await Promise.all([
    prisma.flashSale.findMany({
      where: { isActive: true, startsAt: { lte: now }, endsAt: { gt: now }, store: { status: "ACTIVE", vacationMode: false } },
      orderBy: { endsAt: "asc" },
      take: 30,
      select: {
        id: true,
        name: true,
        discountBps: true,
        endsAt: true,
        store: { select: { name: true } },
        listings: { take: 24, select: { listing: { select: listingCardSelect } }, where: { listing: publicListingWhere } },
      },
    }),
    getFxRates(),
    getViewerCurrency(),
  ]);
  const live = sales.filter((sale) => sale.listings.length > 0);

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-4 py-8">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">Flash deals</h1>
        <p className="text-muted-foreground">Limited-time prices. Every purchase is still protected by escrow.</p>
      </div>
      {live.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border p-10 text-center text-sm text-muted-foreground">No flash sales are running right now. Check back soon.</p>
      ) : (
        live.map((sale) => (
          <section key={sale.id} aria-label={sale.name} className="flex flex-col gap-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-xl font-semibold tracking-tight">
                {sale.name} <span className="text-base font-normal text-muted-foreground">· {sale.store.name}</span>
              </h2>
              <p className="text-sm">
                <span className="font-semibold text-destructive">{Math.round(sale.discountBps / 100)}% off</span> · ends in{" "}
                <Countdown endsAt={sale.endsAt.toISOString()} className="font-mono" />
              </p>
            </div>
            <ListingGrid listings={sale.listings.map((row) => cardFromRow(row.listing))} viewerCurrency={viewerCurrency} fx={fx} />
          </section>
        ))
      )}
    </div>
  );
}
