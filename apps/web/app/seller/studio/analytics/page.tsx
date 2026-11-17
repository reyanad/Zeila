import type { Metadata } from "next";
import Link from "next/link";
import { sellerAnalytics } from "@marketplace/core";
import { DailyColumns } from "@/components/growth/daily-columns";
import { StatTile } from "@/components/growth/stat-tile";
import { formatPrice } from "@/components/storefront/price";
import { requireStudio } from "@/lib/studio/context";

export const metadata: Metadata = { title: "Analytics" };
export const dynamic = "force-dynamic";

const RANGES = [7, 30, 90] as const;

function percentChange(current: number, previous: number): number | null {
  if (previous === 0) return current === 0 ? 0 : null;
  return Math.round(((current - previous) / previous) * 100);
}

export default async function AnalyticsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { store } = await requireStudio("/seller/studio/analytics");
  const params = await searchParams;
  const requested = Number(typeof params.days === "string" ? params.days : "30");
  const days = (RANGES as readonly number[]).includes(requested) ? requested : 30;
  const stats = await sellerAnalytics(store.id, store.currency, days, new Date());
  const money = (amount: number) => formatPrice(amount, store.currency);
  const period = `previous ${days} days`;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">Analytics</h1>
        <nav aria-label="Date range" className="flex gap-2">
          {RANGES.map((range) => (
            <Link
              key={range}
              href={`/seller/studio/analytics?days=${range}`}
              aria-current={range === days ? "page" : undefined}
              className={`rounded-full px-3 py-1 text-sm ${range === days ? "bg-primary text-primary-foreground" : "bg-muted hover:bg-accent"}`}
            >
              Last {range} days
            </Link>
          ))}
        </nav>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Sales" value={money(stats.sales)} delta={{ change: percentChange(stats.sales, stats.previousSales), period }} />
        <StatTile label="Orders" value={stats.orders.toLocaleString("en-US")} delta={{ change: percentChange(stats.orders, stats.previousOrders), period }} />
        <StatTile label="Average order" value={stats.averageOrder === null ? "—" : money(stats.averageOrder)} note={`${stats.units.toLocaleString("en-US")} units sold`} />
        <StatTile
          label="Conversion"
          value={stats.conversion === null ? "—" : `${stats.conversion}%`}
          note={`${stats.views.toLocaleString("en-US")} listing views`}
        />
        <StatTile label="Refunded" value={money(stats.refunds)} note={stats.sales > 0 ? `${Math.round((stats.refunds / stats.sales) * 1000) / 10}% of sales` : undefined} />
        <StatTile label="Rating" value={stats.rating.count > 0 ? `${stats.rating.average.toFixed(1)} ★` : "—"} note={`${stats.rating.count} review${stats.rating.count === 1 ? "" : "s"}`} />
        <StatTile label="Held in escrow" value={money(stats.balances.escrow)} note="Released after delivery and the protection window" />
        <StatTile label="Released, awaiting payout" value={money(stats.balances.payable)} note="Sent to your bank by Stripe" />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <DailyColumns title={`Sales per day (${store.currency})`} points={stats.daily.map((point) => ({ day: point.day, value: point.sales }))} divisor={100} unit={store.currency} emptyLabel="No sales in this period yet." />
        <DailyColumns title="Listing views per day" points={stats.daily.map((point) => ({ day: point.day, value: point.views }))} emptyLabel="No views recorded in this period yet." />
      </div>

      <details className="rounded-lg border border-border p-4 text-sm">
        <summary className="cursor-pointer font-medium">Show the numbers as a table</summary>
        <table className="mt-3 w-full text-left tabular-nums">
          <thead className="text-xs text-muted-foreground">
            <tr>
              <th className="py-1 font-medium">Day</th>
              <th className="py-1 text-right font-medium">Sales</th>
              <th className="py-1 text-right font-medium">Orders</th>
              <th className="py-1 text-right font-medium">Views</th>
            </tr>
          </thead>
          <tbody>
            {stats.daily.map((point) => (
              <tr key={point.day} className="border-t border-border">
                <td className="py-1">{point.day}</td>
                <td className="py-1 text-right">{money(point.sales)}</td>
                <td className="py-1 text-right">{point.orders}</td>
                <td className="py-1 text-right">{point.views}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>

      <section aria-labelledby="top-heading" className="flex flex-col gap-3">
        <h2 id="top-heading" className="text-lg font-semibold">
          Top listings
        </h2>
        {stats.top.length === 0 ? (
          <p className="text-sm text-muted-foreground">Sales by listing appear here once orders come in.</p>
        ) : (
          <table className="w-full text-left text-sm tabular-nums">
            <thead className="text-xs text-muted-foreground">
              <tr>
                <th className="py-1 font-medium">Listing</th>
                <th className="py-1 text-right font-medium">Sales</th>
                <th className="py-1 text-right font-medium">Units</th>
                <th className="py-1 text-right font-medium">Views</th>
                <th className="py-1 text-right font-medium">Orders per 100 views</th>
              </tr>
            </thead>
            <tbody>
              {stats.top.map((row) => (
                <tr key={row.listingId} className="border-t border-border">
                  <td className="max-w-[16rem] truncate py-2">{row.title}</td>
                  <td className="py-2 text-right">{money(row.sales)}</td>
                  <td className="py-2 text-right">{row.units}</td>
                  <td className="py-2 text-right">{row.views}</td>
                  <td className="py-2 text-right">{row.views > 0 ? `${Math.round((row.units / row.views) * 1000) / 10}` : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
