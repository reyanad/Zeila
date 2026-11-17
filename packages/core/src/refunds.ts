import type Stripe from "stripe";
import { prisma, type Prisma } from "@marketplace/database";
import { CheckoutError } from "./errors";
import { rollupOrderStatus, settleSubOrder } from "./fulfillment";
import { accounts, postEntry } from "./ledger";
import { rollupSubOrderStatus } from "./status";

/**
 * Refunds come out of escrow, so they are only possible while the sub-order's
 * money is still on the platform (escrow HELD or FROZEN). The refund is shared
 * in proportion between the store's escrow, the platform's commission and any
 * platform-funded discount, so a full refund exactly unwinds the payment entry.
 */

export interface RefundSplit {
  escrowPart: number;
  feePart: number;
  promoPart: number;
}

/**
 * Split refund `amount` of a sub-order the buyer paid `paid` for, where the
 * store nets `net`, the platform earned `fee` and funded `discount`.
 * Balances by construction: escrowPart + feePart = amount + promoPart.
 */
export function refundSplit(paid: number, fee: number, discount: number, amount: number): RefundSplit {
  if (paid <= 0) return { escrowPart: 0, feePart: 0, promoPart: 0 };
  const feePart = Math.round((fee * amount) / paid);
  const promoPart = Math.round((discount * amount) / paid);
  return { escrowPart: amount + promoPart - feePart, feePart, promoPart };
}

export interface RefundRequest {
  subOrderId: string;
  amount: number;
  reason: string;
  /** Stable per business event, e.g. "rma:<id>" or "seller-cancel:<subOrderId>". */
  idempotencyKey: string;
  /** Items to mark REFUNDED (and licences to revoke). */
  refundedItemIds: string[];
  /** Units to put back on the shelf, per order item. */
  restock: Array<{ orderItemId: string; quantity: number }>;
}

function promoFunding(metadata: Prisma.JsonValue): "store" | "platform" | null {
  const promo = typeof metadata === "object" && metadata !== null && !Array.isArray(metadata) ? (metadata as Record<string, unknown>).promo : null;
  const fundedBy = typeof promo === "object" && promo !== null ? (promo as Record<string, unknown>).fundedBy : null;
  return fundedBy === "store" || fundedBy === "platform" ? fundedBy : null;
}

export async function refundSubOrder(stripe: Stripe | null, request: RefundRequest, now: Date): Promise<void> {
  const subOrder = await prisma.subOrder.findUnique({
    where: { id: request.subOrderId },
    select: {
      id: true,
      orderId: true,
      storeId: true,
      currency: true,
      itemsSubtotal: true,
      discountTotal: true,
      shippingTotal: true,
      taxTotal: true,
      grandTotal: true,
      platformFee: true,
      refundedTotal: true,
      escrow: { select: { id: true, status: true, amount: true, refunded: true } },
      order: { select: { metadata: true, payments: { where: { status: { in: ["SUCCEEDED", "PARTIALLY_REFUNDED"] } }, select: { id: true, stripePaymentIntentId: true, amount: true }, take: 1 } } },
    },
  });
  if (!subOrder) throw new CheckoutError("That order does not exist.");
  const remaining = subOrder.grandTotal - subOrder.refundedTotal;
  if (!Number.isInteger(request.amount) || request.amount < 0 || request.amount > remaining) {
    throw new CheckoutError(`Refunds for this order can be at most ${remaining} (minor units).`);
  }
  const escrow = subOrder.escrow;
  if (!escrow || (escrow.status !== "HELD" && escrow.status !== "FROZEN")) {
    throw new CheckoutError("The seller has already been paid for this order; open a dispute so the platform can recover the funds.");
  }

  const settlement = settleSubOrder(subOrder, promoFunding(subOrder.order.metadata));
  const split = refundSplit(subOrder.grandTotal, settlement.fee, settlement.platformDiscount, request.amount);
  const payment = subOrder.order.payments[0];

  let stripeRefund: Stripe.Refund | null = null;
  if (request.amount > 0) {
    if (!payment) throw new CheckoutError("No captured payment was found for this order.");
    if (!stripe) throw new CheckoutError("Refunds need Stripe, which is not configured.");
    stripeRefund = await stripe.refunds.create(
      { payment_intent: payment.stripePaymentIntentId, amount: request.amount, metadata: { subOrderId: subOrder.id, reason: request.reason.slice(0, 400) } },
      { idempotencyKey: `refund-${request.idempotencyKey}` },
    );
  }

  await prisma.$transaction(async (tx) => {
    if (stripeRefund && payment) {
      await tx.refund.upsert({
        where: { stripeRefundId: stripeRefund.id },
        create: { paymentId: payment.id, stripeRefundId: stripeRefund.id, amount: stripeRefund.amount, reason: request.reason.slice(0, 500) },
        update: {},
      });
      const refunded = await tx.refund.aggregate({ where: { paymentId: payment.id }, _sum: { amount: true } });
      await tx.payment.update({ where: { id: payment.id }, data: { status: (refunded._sum.amount ?? 0) >= payment.amount ? "REFUNDED" : "PARTIALLY_REFUNDED" } });
    }

    const posted =
      request.amount > 0
        ? await postEntry(tx, {
            idempotencyKey: `refund:${request.idempotencyKey}`,
            description: `Refund for sub-order ${subOrder.id}: ${request.reason.slice(0, 120)}`,
            occurredAt: now,
            metadata: { subOrderId: subOrder.id, stripeRefundId: stripeRefund?.id ?? null },
            lines: [
              { account: accounts.escrow(subOrder.storeId, subOrder.currency), direction: "DEBIT", amount: split.escrowPart },
              { account: accounts.fees(subOrder.currency), direction: "DEBIT", amount: split.feePart },
              { account: accounts.cash(subOrder.currency), direction: "CREDIT", amount: request.amount },
              { account: accounts.promotions(subOrder.currency), direction: "CREDIT", amount: split.promoPart },
            ],
          })
        : true;
    if (!posted) return; // the same refund event was already applied

    const fullyRefunded = subOrder.refundedTotal + request.amount >= subOrder.grandTotal;
    await tx.subOrder.update({ where: { id: subOrder.id }, data: { refundedTotal: { increment: request.amount } } });
    await tx.escrow.update({
      where: { id: escrow.id },
      data: { refunded: { increment: split.escrowPart }, ...(fullyRefunded ? { status: "REFUNDED" } : {}) },
    });
    if (request.refundedItemIds.length > 0) {
      await tx.orderItem.updateMany({ where: { id: { in: request.refundedItemIds }, subOrderId: subOrder.id }, data: { status: "REFUNDED" } });
      await tx.licenseKey.updateMany({
        where: { orderItemId: { in: request.refundedItemIds }, status: { not: "REVOKED" } },
        data: { status: "REVOKED", revokedAt: now, revokedReason: "Purchase refunded" },
      });
    }
    for (const line of request.restock) {
      let left = line.quantity;
      const committed = await tx.inventoryReservation.findMany({ where: { orderItemId: line.orderItemId, status: "COMMITTED" }, orderBy: { createdAt: "asc" } });
      for (const reservation of committed) {
        if (left <= 0) break;
        const back = Math.min(left, reservation.quantity);
        await tx.inventoryLevel.update({ where: { id: reservation.inventoryLevelId }, data: { onHand: { increment: back } } });
        left -= back;
      }
    }
    if (fullyRefunded) await tx.subOrder.update({ where: { id: subOrder.id }, data: { status: "REFUNDED" } });
    else await rollupSubOrderStatus(tx, subOrder.id, now);
    await rollupOrderStatus(tx, subOrder.orderId);
  });
}
