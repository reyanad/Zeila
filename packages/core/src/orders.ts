import type Stripe from "stripe";
import { prisma, type Prisma } from "@marketplace/database";
import { commitReservations, releaseReservations } from "./inventory";

/**
 * Hooks run inside the payment transaction once an order is paid. Phase 6
 * registers ledger, escrow and digital-delivery steps here; keeping them in
 * the same transaction means an order is never "paid" without its records.
 */
export type PaidOrderHook = (tx: Prisma.TransactionClient, orderId: string, paidAt: Date) => Promise<void>;
const paidOrderHooks: PaidOrderHook[] = [];

export function onOrderPaid(hook: PaidOrderHook): void {
  if (!paidOrderHooks.includes(hook)) paidOrderHooks.push(hook);
}

export type PaymentOutcome = "completed" | "already-paid" | "amount-mismatch" | "not-pending" | "missing";

export interface PaymentReceipt {
  orderId: string;
  /** null for orders that cost nothing. */
  paymentIntentId: string | null;
  chargeId: string | null;
  amount: number;
  currency: string;
  paidAt: Date;
}

/**
 * Mark an order paid: statuses, payment row, stock committed, purchased
 * lines removed from the buyer's cart, sales counters, then every registered
 * hook, all atomically. Safe to call twice for the same payment.
 */
export async function completeOrderPayment(receipt: PaymentReceipt): Promise<PaymentOutcome> {
  return prisma.$transaction(
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
      if (receipt.paymentIntentId) {
        await tx.payment.update({
          where: { stripePaymentIntentId: receipt.paymentIntentId },
          data: { status: "SUCCEEDED", stripeChargeId: receipt.chargeId, failureReason: null },
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
      for (const hook of paidOrderHooks) await hook(tx, order.id, receipt.paidAt);
      return "completed";
    },
    { timeout: 30_000 },
  );
}

/** Cancel an unpaid order: stock and promo usage are given back. */
export async function cancelUnpaidOrder(orderId: string): Promise<boolean> {
  return prisma.$transaction(async (tx) => {
    const claimed = await tx.order.updateMany({ where: { id: orderId, status: "PENDING_PAYMENT" }, data: { status: "CANCELLED", cancelledAt: new Date() } });
    if (claimed.count === 0) return false;
    await tx.subOrder.updateMany({ where: { orderId }, data: { status: "CANCELLED", cancelledAt: new Date() } });
    await tx.payment.updateMany({ where: { orderId, status: { in: ["REQUIRES_ACTION", "PROCESSING", "FAILED"] } }, data: { status: "CANCELLED" } });
    await tx.promoRedemption.deleteMany({ where: { orderId } });
    await releaseReservations(tx, orderId);
    return true;
  });
}

const IN_FLIGHT_STATUSES: ReadonlySet<string> = new Set(["processing", "requires_capture", "succeeded"]);

/**
 * Cancel an unpaid order and its PaymentIntents, unless Stripe is still
 * processing (or has completed) a payment for it; then the order is left for
 * the webhook. Returns whether the order was cancelled.
 */
export async function abandonOrder(stripe: Stripe | null, orderId: string): Promise<boolean> {
  const payments = await prisma.payment.findMany({ where: { orderId, status: { notIn: ["CANCELLED", "SUCCEEDED"] } } });
  if (stripe) {
    for (const payment of payments) {
      const intent = await stripe.paymentIntents.retrieve(payment.stripePaymentIntentId);
      if (IN_FLIGHT_STATUSES.has(intent.status)) return false;
      if (intent.status !== "canceled") {
        await stripe.paymentIntents.cancel(intent.id).catch((error: unknown) => {
          console.error(`[orders] could not cancel PaymentIntent ${intent.id}`, error);
        });
      }
    }
  } else if (payments.length > 0) {
    // Without Stripe credentials the payment state cannot be checked; leave the order alone.
    return false;
  }
  return cancelUnpaidOrder(orderId);
}

/** Sweep: cancel unpaid orders past their payment deadline. Run every few minutes. */
export async function expireStaleOrders(stripe: Stripe | null, now: Date, limit = 100): Promise<number> {
  const stale = await prisma.order.findMany({
    where: { status: "PENDING_PAYMENT", expiresAt: { lt: now } },
    orderBy: { expiresAt: "asc" },
    take: limit,
    select: { id: true },
  });
  let cancelled = 0;
  for (const order of stale) {
    try {
      if (await abandonOrder(stripe, order.id)) cancelled += 1;
    } catch (error) {
      console.error(`[orders] could not expire order ${order.id}`, error);
    }
  }
  return cancelled;
}

/** Before a new checkout, cancel the buyer's earlier unpaid orders in the same currency (they hold stock). */
export async function abandonPendingOrders(stripe: Stripe | null, buyerId: string, currency: string): Promise<void> {
  const pending = await prisma.order.findMany({ where: { buyerId, currency, status: "PENDING_PAYMENT" }, select: { id: true } });
  for (const order of pending) await abandonOrder(stripe, order.id);
}
