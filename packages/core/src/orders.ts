import { prisma } from "@marketplace/database";
import { fulfillPaidOrder } from "./fulfillment";
import { recordReferralForPaidOrder } from "./affiliates";
import { releaseFlashUnits } from "./flash-sales";
import { commitReservations, releaseReservations } from "./inventory";
import { displayAmount, notify } from "./notifications";
import { getSetting } from "./settings";

export type PaymentOutcome = "completed" | "already-paid" | "amount-mismatch" | "not-pending" | "missing";

export interface PaymentReceipt {
  orderId: string;
  /** Our tx_ref for the payment attempt; null for orders that cost nothing. */
  providerRef: string | null;
  /** The provider's reference for the charge. */
  providerReference: string | null;
  amount: number;
  currency: string;
  paidAt: Date;
}

/**
 * Mark an order paid: statuses, payment row, stock committed, purchased
 * lines removed from the buyer's cart, sales counters, the ledger entry,
 * escrow and digital delivery, all in one transaction. An order is never
 * "paid" without its money records. Safe to call twice for the same payment.
 */
export async function completeOrderPayment(receipt: PaymentReceipt): Promise<PaymentOutcome> {
  const escrowHoldDays = await getSetting("escrowHoldDays");
  const outcome: PaymentOutcome = await prisma.$transaction(
    async (tx) => {
      const order = await tx.order.findUnique({
        where: { id: receipt.orderId },
        select: {
          id: true,
          status: true,
          grandTotal: true,
          currency: true,
          buyerId: true,
          subOrders: { select: { id: true, items: { select: { id: true, listingId: true, skuId: true, serviceTierId: true, quantity: true } } } },
        },
      });
      if (!order) return "missing";
      if (order.status !== "PENDING_PAYMENT") return order.status === "PAID" ? "already-paid" : "not-pending";
      if (order.grandTotal !== receipt.amount || order.currency !== receipt.currency) return "amount-mismatch";

      // Claim the order first: the conditional update makes a concurrent duplicate a no-op.
      const claimed = await tx.order.updateMany({ where: { id: order.id, status: "PENDING_PAYMENT" }, data: { status: "PAID", paidAt: receipt.paidAt } });
      if (claimed.count === 0) return "already-paid";
      await tx.subOrder.updateMany({ where: { orderId: order.id }, data: { status: "PAID" } });
      if (receipt.providerRef) {
        await tx.payment.update({
          where: { providerRef: receipt.providerRef },
          data: { status: "SUCCEEDED", providerReference: receipt.providerReference, failureReason: null },
        });
      }
      await commitReservations(tx, order.id);

      const items = order.subOrders.flatMap((subOrder) => subOrder.items);
      for (const item of items) {
        await tx.listing.update({ where: { id: item.listingId }, data: { salesCount: { increment: item.quantity } } });
      }
      const cart = await tx.cart.findFirst({ where: { userId: order.buyerId, status: "ACTIVE" }, select: { id: true } });
      if (cart) {
        await tx.cartItem.deleteMany({
          where: { cartId: cart.id, OR: items.map((item) => ({ listingId: item.listingId, skuId: item.skuId, serviceTierId: item.serviceTierId })) },
        });
      }
      await fulfillPaidOrder(tx, order.id, receipt.paidAt, escrowHoldDays);
      return "completed";
    },
    { timeout: 30_000 },
  );
  if (outcome === "completed") {
    await notifyOrderPaid(receipt.orderId);
    await recordReferralForPaidOrder(receipt.orderId).catch((error: unknown) => console.error("[affiliates] could not record referral", error));
  }
  return outcome;
}

async function notifyOrderPaid(orderId: string): Promise<void> {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: {
      id: true,
      orderNumber: true,
      buyerId: true,
      grandTotal: true,
      currency: true,
      subOrders: { select: { id: true, grandTotal: true, store: { select: { sellerId: true } }, items: { select: { titleSnapshot: true, quantity: true } } } },
    },
  });
  if (!order) return;
  await notify([
    {
      userId: order.buyerId,
      type: "ORDER_PAID",
      title: `Payment confirmed for order ${order.orderNumber}`,
      body: `${displayAmount(order.grandTotal, order.currency)} is held in escrow until your order is delivered.`,
      href: `/orders/${order.id}`,
    },
    ...order.subOrders.map((subOrder) => ({
      userId: subOrder.store.sellerId,
      type: "ORDER_PLACED" as const,
      title: `New order ${order.orderNumber}`,
      body: `${subOrder.items.map((item) => `${item.quantity} × ${item.titleSnapshot}`).join(", ").slice(0, 300)} (${displayAmount(subOrder.grandTotal, order.currency)})`,
      href: `/seller/studio/orders/${subOrder.id}`,
    })),
  ]);
}

/** Cancel an unpaid order: stock and promo usage are given back. */
export async function cancelUnpaidOrder(orderId: string): Promise<boolean> {
  return prisma.$transaction(async (tx) => {
    const claimed = await tx.order.updateMany({ where: { id: orderId, status: "PENDING_PAYMENT" }, data: { status: "CANCELLED", cancelledAt: new Date() } });
    if (claimed.count === 0) return false;
    await tx.subOrder.updateMany({ where: { orderId }, data: { status: "CANCELLED", cancelledAt: new Date() } });
    await releaseFlashUnits(tx, orderId);
    await tx.payment.updateMany({ where: { orderId, status: { in: ["REQUIRES_ACTION", "PROCESSING", "FAILED"] } }, data: { status: "CANCELLED" } });
    await tx.promoRedemption.deleteMany({ where: { orderId } });
    await releaseReservations(tx, orderId);
    return true;
  });
}
