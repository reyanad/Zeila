import { prisma } from "@marketplace/database";
import { json, withMobileUser } from "@/lib/mobile/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  return withMobileUser(request, async (user) => {
    const orders = await prisma.order.findMany({
      where: { buyerId: user.id },
      orderBy: { placedAt: "desc" },
      take: 50,
      select: {
        id: true,
        orderNumber: true,
        status: true,
        currency: true,
        grandTotal: true,
        placedAt: true,
        subOrders: { select: { store: { select: { name: true } }, items: { select: { titleSnapshot: true, quantity: true } } } },
      },
    });
    return json({
      items: orders.map((order) => ({
        id: order.id,
        orderNumber: order.orderNumber,
        status: order.status,
        currency: order.currency,
        total: order.grandTotal,
        placedAt: order.placedAt.toISOString(),
        stores: order.subOrders.map((subOrder) => subOrder.store.name),
        summary: order.subOrders.flatMap((subOrder) => subOrder.items.map((item) => `${item.quantity} × ${item.titleSnapshot}`)).join(", ").slice(0, 200),
      })),
    });
  });
}
