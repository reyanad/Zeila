import { prisma, Prisma } from "@marketplace/database";
import { balancesByPrefix } from "./ledger";

/**
 * Seller analytics over a trailing window, compared with the window before
 * it. Sales are item totals after discounts, in the store's currency, for
 * paid orders; refunds are reported separately.
 */

export interface DailyPoint {
  day: string; // YYYY-MM-DD (UTC)
  sales: number;
  orders: number;
  views: number;
}

export interface TopListing {
  listingId: string;
  title: string;
  sales: number;
  units: number;
  views: number;
}

export interface SellerAnalytics {
  currency: string;
  days: number;
  sales: number;
  previousSales: number;
  orders: number;
  previousOrders: number;
  units: number;
  refunds: number;
  views: number;
  /** Orders per 100 listing views. */
  conversion: number | null;
  averageOrder: number | null;
  rating: { average: number; count: number };
  daily: DailyPoint[];
  top: TopListing[];
  balances: { escrow: number; payable: number };
}

const DAY_MS = 86_400_000;

function utcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

/** Count a listing page view for today (UTC). */
export async function recordListingView(listingId: string, now: Date): Promise<void> {
  const day = utcDay(now);
  await prisma.$transaction([
    prisma.listingViewDaily.upsert({ where: { listingId_day: { listingId, day } }, create: { listingId, day, views: 1 }, update: { views: { increment: 1 } } }),
    prisma.listing.update({ where: { id: listingId }, data: { viewCount: { increment: 1 } } }),
  ]);
}

interface WindowTotals {
  sales: number;
  orders: number;
  refunds: number;
}

async function windowTotals(storeId: string, currency: string, from: Date, to: Date): Promise<WindowTotals> {
  const rows = await prisma.$queryRaw<Array<{ sales: bigint | null; orders: bigint; refunds: bigint | null }>>`
    SELECT SUM(s."itemsSubtotal" - s."discountTotal") AS sales, COUNT(*) AS orders, SUM(s."refundedTotal") AS refunds
    FROM "SubOrder" s JOIN "Order" o ON o."id" = s."orderId"
    WHERE s."storeId" = ${storeId} AND s."currency" = ${currency} AND o."paidAt" >= ${from} AND o."paidAt" < ${to}
      AND s."status" NOT IN ('PENDING_PAYMENT', 'CANCELLED')`;
  const row = rows[0];
  return { sales: Number(row?.sales ?? 0), orders: Number(row?.orders ?? 0), refunds: Number(row?.refunds ?? 0) };
}

export async function sellerAnalytics(storeId: string, currency: string, days: number, now: Date): Promise<SellerAnalytics> {
  const to = new Date(utcDay(now).getTime() + DAY_MS);
  const from = new Date(to.getTime() - days * DAY_MS);
  const previousFrom = new Date(from.getTime() - days * DAY_MS);

  const [current, previous, dailySales, dailyViews, units, topRows, rating, balances] = await Promise.all([
    windowTotals(storeId, currency, from, to),
    windowTotals(storeId, currency, previousFrom, from),
    prisma.$queryRaw<Array<{ day: Date; sales: bigint | null; orders: bigint }>>`
      SELECT date_trunc('day', o."paidAt" AT TIME ZONE 'UTC') AS day, SUM(s."itemsSubtotal" - s."discountTotal") AS sales, COUNT(*) AS orders
      FROM "SubOrder" s JOIN "Order" o ON o."id" = s."orderId"
      WHERE s."storeId" = ${storeId} AND s."currency" = ${currency} AND o."paidAt" >= ${from} AND o."paidAt" < ${to}
        AND s."status" NOT IN ('PENDING_PAYMENT', 'CANCELLED')
      GROUP BY 1`,
    prisma.$queryRaw<Array<{ day: Date; views: bigint }>>`
      SELECT v."day" AS day, SUM(v."views") AS views
      FROM "ListingViewDaily" v JOIN "Listing" l ON l."id" = v."listingId"
      WHERE l."storeId" = ${storeId} AND v."day" >= ${from} AND v."day" < ${to}
      GROUP BY 1`,
    prisma.orderItem.aggregate({
      where: { subOrder: { storeId, currency, status: { notIn: ["PENDING_PAYMENT", "CANCELLED"] }, order: { paidAt: { gte: from, lt: to } } } },
      _sum: { quantity: true },
    }),
    prisma.$queryRaw<Array<{ listingId: string; title: string; sales: bigint | null; units: bigint | null }>>`
      SELECT i."listingId" AS "listingId", MAX(i."titleSnapshot") AS title, SUM(i."lineTotal") AS sales, SUM(i."quantity") AS units
      FROM "OrderItem" i JOIN "SubOrder" s ON s."id" = i."subOrderId" JOIN "Order" o ON o."id" = s."orderId"
      WHERE s."storeId" = ${storeId} AND s."currency" = ${currency} AND o."paidAt" >= ${from} AND o."paidAt" < ${to}
        AND s."status" NOT IN ('PENDING_PAYMENT', 'CANCELLED')
      GROUP BY i."listingId" ORDER BY sales DESC NULLS LAST LIMIT 10`,
    prisma.review.aggregate({ where: { status: "PUBLISHED", listing: { storeId } }, _avg: { rating: true }, _count: { _all: true } }),
    balancesByPrefix(`store:${storeId}:`),
  ]);

  const viewsByListing = topRows.length
    ? await prisma.listingViewDaily.groupBy({ by: ["listingId"], where: { listingId: { in: topRows.map((row) => row.listingId) }, day: { gte: from, lt: to } }, _sum: { views: true } })
    : [];
  const viewMap = new Map(viewsByListing.map((row) => [row.listingId, row._sum.views ?? 0]));

  const salesByDay = new Map(dailySales.map((row) => [row.day.toISOString().slice(0, 10), { sales: Number(row.sales ?? 0), orders: Number(row.orders) }]));
  const viewsByDay = new Map(dailyViews.map((row) => [row.day.toISOString().slice(0, 10), Number(row.views)]));
  const daily: DailyPoint[] = [];
  for (let time = from.getTime(); time < to.getTime(); time += DAY_MS) {
    const key = new Date(time).toISOString().slice(0, 10);
    daily.push({ day: key, sales: salesByDay.get(key)?.sales ?? 0, orders: salesByDay.get(key)?.orders ?? 0, views: viewsByDay.get(key) ?? 0 });
  }
  const views = daily.reduce((sum, point) => sum + point.views, 0);
  const balance = (suffix: string) => balances.filter((row) => row.code.endsWith(`:${suffix}:${currency}`)).reduce((sum, row) => sum + row.balance, 0);

  return {
    currency,
    days,
    sales: current.sales,
    previousSales: previous.sales,
    orders: current.orders,
    previousOrders: previous.orders,
    units: units._sum.quantity ?? 0,
    refunds: current.refunds,
    views,
    conversion: views > 0 ? Math.round((current.orders / views) * 10_000) / 100 : null,
    averageOrder: current.orders > 0 ? Math.round(current.sales / current.orders) : null,
    rating: { average: Number(new Prisma.Decimal(rating._avg.rating ?? 0).toFixed(2)), count: rating._count._all },
    daily,
    top: topRows.map((row) => ({ listingId: row.listingId, title: row.title, sales: Number(row.sales ?? 0), units: Number(row.units ?? 0), views: viewMap.get(row.listingId) ?? 0 })),
    balances: { escrow: balance("escrow"), payable: balance("payable") },
  };
}
