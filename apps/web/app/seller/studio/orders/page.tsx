import type { Metadata } from "next";
import Link from "next/link";
import { prisma, type Prisma } from "@marketplace/database";
import { Badge } from "@marketplace/ui";
import { formatPrice } from "@/components/storefront/price";
import { SUB_ORDER_STATUS } from "@/lib/orders/labels";
import { requireStudio } from "@/lib/studio/context";

export const metadata: Metadata = { title: "Orders" };

const TABS = {
  todo: { label: "To do", where: { status: { in: ["PAID", "PROCESSING", "IN_PROGRESS"] } } },
  sent: { label: "Shipped or delivered", where: { status: { in: ["SHIPPED", "DELIVERED", "SUBMITTED"] } } },
  returns: { label: "Returns", where: { items: { some: { rmaRequests: { some: { status: { in: ["REQUESTED", "APPROVED", "AWAITING_RETURN", "RECEIVED"] } } } } } } },
  done: { label: "Completed", where: { status: { in: ["COMPLETED", "REFUNDED", "DISPUTED"] } } },
} satisfies Record<string, { label: string; where: Prisma.SubOrderWhereInput }>;

export default async function SellerOrdersPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { store } = await requireStudio("/seller/studio/orders");
  const params = await searchParams;
  const tab = typeof params.tab === "string" && params.tab in TABS ? (params.tab as keyof typeof TABS) : "todo";
  const subOrders = await prisma.subOrder.findMany({
    where: { storeId: store.id, ...TABS[tab].where },
    orderBy: { order: { placedAt: "desc" } },
    take: 100,
    select: {
      id: true,
      status: true,
      grandTotal: true,
      currency: true,
      order: { select: { orderNumber: true, placedAt: true, buyer: { select: { name: true } } } },
      items: { select: { titleSnapshot: true, quantity: true, listingType: true } },
    },
  });

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold tracking-tight">Orders</h1>
      <nav aria-label="Order status" className="flex flex-wrap gap-2">
        {Object.entries(TABS).map(([key, value]) => (
          <Link
            key={key}
            href={`/seller/studio/orders?tab=${key}`}
            aria-current={key === tab ? "page" : undefined}
            className={`rounded-full px-3 py-1 text-sm ${key === tab ? "bg-primary text-primary-foreground" : "bg-muted hover:bg-accent"}`}
          >
            {value.label}
          </Link>
        ))}
      </nav>
      {subOrders.length === 0 ? (
        <p className="rounded-md border border-dashed border-border p-10 text-center text-sm text-muted-foreground">Nothing here.</p>
      ) : (
        <ul className="flex flex-col divide-y divide-border rounded-md border border-border">
          {subOrders.map((subOrder) => (
            <li key={subOrder.id}>
              <Link href={`/seller/studio/orders/${subOrder.id}`} className="flex flex-wrap items-center justify-between gap-3 p-4 hover:bg-accent">
                <div className="flex min-w-0 flex-col">
                  <span className="font-medium">
                    {subOrder.order.orderNumber} · {subOrder.order.buyer.name ?? "Buyer"}
                  </span>
                  <span className="truncate text-xs text-muted-foreground">
                    {subOrder.items.map((item) => `${item.quantity} × ${item.titleSnapshot}`).join(", ")}
                  </span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-sm tabular-nums">{formatPrice(subOrder.grandTotal, subOrder.currency)}</span>
                  <Badge tone={SUB_ORDER_STATUS[subOrder.status]?.tone ?? "neutral"}>{SUB_ORDER_STATUS[subOrder.status]?.label ?? subOrder.status}</Badge>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
