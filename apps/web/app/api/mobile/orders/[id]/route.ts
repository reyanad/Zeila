import { prisma } from "@marketplace/database";
import { absoluteUrl } from "@/lib/env";
import { json, withMobileUser } from "@/lib/mobile/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await params;
  return withMobileUser(request, async (user) => {
    const order = await prisma.order.findFirst({
      where: { id, buyerId: user.id },
      select: {
        id: true,
        orderNumber: true,
        status: true,
        currency: true,
        grandTotal: true,
        placedAt: true,
        subOrders: {
          select: {
            id: true,
            status: true,
            grandTotal: true,
            store: { select: { name: true } },
            escrow: { select: { status: true, holdUntil: true } },
            shipments: { select: { carrier: true, trackingNumber: true, trackingUrl: true, status: true } },
            items: { select: { id: true, titleSnapshot: true, quantity: true, lineTotal: true, listingType: true, status: true } },
          },
        },
      },
    });
    if (!order) return json({ error: "Not found" }, 404);
    return json({
      id: order.id,
      orderNumber: order.orderNumber,
      status: order.status,
      currency: order.currency,
      total: order.grandTotal,
      placedAt: order.placedAt.toISOString(),
      webUrl: absoluteUrl(`/orders/${order.id}`),
      subOrders: order.subOrders.map((subOrder) => ({
        id: subOrder.id,
        status: subOrder.status,
        total: subOrder.grandTotal,
        storeName: subOrder.store.name,
        escrow: subOrder.escrow ? { status: subOrder.escrow.status, holdUntil: subOrder.escrow.holdUntil.toISOString() } : null,
        canConfirm: subOrder.escrow?.status === "HELD" && (subOrder.status === "SHIPPED" || subOrder.status === "DELIVERED") && subOrder.items.every((item) => item.listingType !== "SERVICE" || ["DELIVERED", "COMPLETED", "REFUNDED", "CANCELLED"].includes(item.status)),
        shipments: subOrder.shipments,
        items: subOrder.items.map((item) => ({
          id: item.id,
          title: item.titleSnapshot,
          quantity: item.quantity,
          total: item.lineTotal,
          type: item.listingType,
          status: item.status,
          workspaceUrl: item.listingType === "SERVICE" ? absoluteUrl(`/orders/${order.id}/work/${item.id}`) : null,
        })),
      })),
    });
  });
}
