import type { Metadata } from "next";
import Link from "next/link";
import { prisma } from "@marketplace/database";
import { Badge } from "@marketplace/ui";
import { formatPrice } from "@/components/storefront/price";
import { requireUser } from "@/lib/auth/session";
import { ORDER_STATUS } from "@/lib/orders/labels";

export const metadata: Metadata = { title: "Your orders", robots: { index: false } };
export const dynamic = "force-dynamic";

export default async function OrdersPage() {
  const user = await requireUser("/orders");
  const orders = await prisma.order.findMany({
    where: { buyerId: user.id },
    orderBy: { placedAt: "desc" },
    take: 100,
    select: { id: true, orderNumber: true, status: true, grandTotal: true, currency: true, placedAt: true, _count: { select: { subOrders: true } } },
  });

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-4 py-8">
      <h1 className="text-2xl font-semibold tracking-tight">Your orders</h1>
      {orders.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border p-10 text-center text-sm text-muted-foreground">No orders yet.</p>
      ) : (
        <ul className="flex flex-col divide-y divide-border rounded-lg border border-border">
          {orders.map((order) => (
            <li key={order.id}>
              <Link href={`/orders/${order.id}`} className="flex flex-wrap items-center justify-between gap-3 p-4 hover:bg-accent">
                <div className="flex flex-col">
                  <span className="font-medium">{order.orderNumber}</span>
                  <span className="text-xs text-muted-foreground">
                    {order.placedAt.toLocaleDateString("en-GB", { dateStyle: "medium" })} · {order._count.subOrders} seller{order._count.subOrders === 1 ? "" : "s"}
                  </span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="tabular-nums">{formatPrice(order.grandTotal, order.currency)}</span>
                  <Badge tone={ORDER_STATUS[order.status]?.tone ?? "neutral"}>{ORDER_STATUS[order.status]?.label ?? order.status}</Badge>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
