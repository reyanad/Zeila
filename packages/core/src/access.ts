import { prisma } from "@marketplace/database";
import { CheckoutError } from "./errors";

/** The sub-order if it belongs to the seller's store (and is paid), otherwise an error. */
export async function sellerSubOrderId(sellerUserId: string, subOrderId: string): Promise<{ id: string; storeId: string; orderId: string; status: string }> {
  const subOrder = await prisma.subOrder.findFirst({
    where: { id: subOrderId, store: { sellerId: sellerUserId } },
    select: { id: true, storeId: true, orderId: true, status: true },
  });
  if (!subOrder) throw new CheckoutError("That order does not exist.");
  if (subOrder.status === "PENDING_PAYMENT" || subOrder.status === "CANCELLED") throw new CheckoutError("This order is not paid.");
  return subOrder;
}

export type ItemRole = "buyer" | "seller";

/** An order item with the caller's role in it, or an error if they have none. */
export async function orderItemForUser(userId: string, orderItemId: string) {
  const item = await prisma.orderItem.findUnique({
    where: { id: orderItemId },
    select: {
      id: true,
      status: true,
      listingType: true,
      listingId: true,
      quantity: true,
      lineTotal: true,
      variantSnapshot: true,
      titleSnapshot: true,
      subOrderId: true,
      subOrder: { select: { id: true, orderId: true, status: true, store: { select: { sellerId: true, name: true } }, order: { select: { buyerId: true } } } },
    },
  });
  if (!item) throw new CheckoutError("That item does not exist.");
  const role: ItemRole | null = item.subOrder.order.buyerId === userId ? "buyer" : item.subOrder.store.sellerId === userId ? "seller" : null;
  if (!role) throw new CheckoutError("That item does not exist.");
  return { item, role };
}
