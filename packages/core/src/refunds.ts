import { createHash } from "node:crypto";
import { prisma, type Prisma } from "@marketplace/database";
import { isUniqueViolation } from "./db";
import { CheckoutError } from "./errors";
import { GatewayError, type PaymentGateway } from "./gateway";
import { rollupOrderStatus, settleSubOrder } from "./fulfillment";
import { accounts, postEntry } from "./ledger";
import { displayAmount, notifySubOrder } from "./notifications";
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
  /**
   * The money already went back to the buyer outside our refund call (a lost
   * chargeback): record it without asking the payment provider for a refund.
   */
  external?: boolean;
}

function promoFunding(metadata: Prisma.JsonValue): "store" | "platform" | null {
  const promo = typeof metadata === "object" && metadata !== null && !Array.isArray(metadata) ? (metadata as Record<string, unknown>).promo : null;
  const fundedBy = typeof promo === "object" && promo !== null ? (promo as Record<string, unknown>).fundedBy : null;
  return fundedBy === "store" || fundedBy === "platform" ? fundedBy : null;
}

/** Stable Chapa refund reference for a business event (Chapa references must be unique per business). */
export function refundReference(idempotencyKey: string): string {
  return `rf-${createHash("sha256").update(idempotencyKey).digest("hex").slice(0, 24)}`;
}

const DUPLICATE_REFERENCE = /reference|duplicate|already/i;

interface RefundablePayment {
  id: string;
  providerRef: string;
}

/**
 * Ask Chapa to refund `amount` of a payment, once per business event. The
 * Refund row is written before the call so concurrent or repeated requests
 * for the same event never send two refunds; a failed request may be retried.
 */
export async function requestProviderRefund(
  gateway: PaymentGateway,
  payment: RefundablePayment,
  input: { idempotencyKey: string; amount: number; currency: string; reason: string },
): Promise<{ id: string; reference: string }> {
  const reference = refundReference(input.idempotencyKey);
  const select = { id: true, reference: true, requestReference: true, status: true, providerRefundId: true } as const;
  let row = await prisma.refund.findUnique({ where: { reference }, select });
  if (row && row.status !== "FAILED" && !(row.status === "REQUESTED" && !row.providerRefundId)) return row;

  if (!row) {
    try {
      row = await prisma.refund.create({
        data: { paymentId: payment.id, reference, requestReference: reference, amount: input.amount, reason: input.reason.slice(0, 500), status: "REQUESTED" },
        select,
      });
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      throw new CheckoutError("This refund is already being processed. Check again in a minute.");
    }
  } else if (row.status === "FAILED") {
    // A refused request may be retried, under a new reference for Chapa.
    row = await prisma.refund.update({
      where: { id: row.id },
      data: { status: "REQUESTED", requestReference: `${reference}-${Date.now().toString(36)}`, amount: input.amount, failureReason: null },
      select,
    });
  }

  try {
    const result = await gateway.refund({ txRef: payment.providerRef, amount: input.amount, currency: input.currency, reference: row.requestReference, reason: input.reason });
    await prisma.refund.update({ where: { id: row.id }, data: { providerRefundId: result.refundId, status: result.state === "REFUNDED" ? "REFUNDED" : "PROCESSING" } });
  } catch (error) {
    if (error instanceof GatewayError && error.httpStatus !== null && error.httpStatus < 500) {
      if (row.requestReference === reference && DUPLICATE_REFERENCE.test(error.message) && row.status === "REQUESTED") {
        // An earlier attempt with this reference reached Chapa; treat it as accepted.
        await prisma.refund.update({ where: { id: row.id }, data: { status: "PROCESSING" } });
        return row;
      }
      await prisma.refund.update({ where: { id: row.id }, data: { status: "FAILED", failureReason: error.message.slice(0, 500) } });
      throw new CheckoutError(error.message);
    }
    // Outcome unknown (network): the row stays REQUESTED and the same reference is re-sent on retry.
    throw error;
  }
  return row;
}

/** Recompute a payment's refund state from its refunds that did not fail. */
async function syncPaymentRefundState(tx: Prisma.TransactionClient, payment: { id: string; amount: number }): Promise<void> {
  const refunded = await tx.refund.aggregate({ where: { paymentId: payment.id, status: { notIn: ["FAILED", "REVERSED"] } }, _sum: { amount: true } });
  const total = refunded._sum.amount ?? 0;
  if (total <= 0) return;
  await tx.payment.update({ where: { id: payment.id }, data: { status: total >= payment.amount ? "REFUNDED" : "PARTIALLY_REFUNDED" } });
}

export async function refundSubOrder(gateway: PaymentGateway | null, request: RefundRequest, now: Date): Promise<void> {
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
      order: { select: { metadata: true, payments: { where: { status: { in: ["SUCCEEDED", "PARTIALLY_REFUNDED"] } }, select: { id: true, providerRef: true, amount: true }, take: 1 } } },
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

  let providerRefund: { id: string; reference: string } | null = null;
  if (request.amount > 0 && !request.external) {
    if (!payment) throw new CheckoutError("No captured payment was found for this order.");
    if (!gateway) throw new CheckoutError("Refunds need Chapa, which is not configured yet.");
    providerRefund = await requestProviderRefund(gateway, payment, {
      idempotencyKey: request.idempotencyKey,
      amount: request.amount,
      currency: subOrder.currency,
      reason: request.reason,
    });
  }

  await prisma.$transaction(async (tx) => {
    if (providerRefund && payment) await syncPaymentRefundState(tx, payment);

    const posted =
      request.amount > 0
        ? await postEntry(tx, {
            idempotencyKey: `refund:${request.idempotencyKey}`,
            description: `Refund for sub-order ${subOrder.id}: ${request.reason.slice(0, 120)}`,
            occurredAt: now,
            metadata: { subOrderId: subOrder.id, refundReference: providerRefund?.reference ?? null },
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
  if (request.amount > 0 && !request.external) {
    await notifySubOrder(subOrder.id, "buyer", {
      type: "REFUND_ISSUED",
      title: "Refund issued for order {order}",
      body: `${displayAmount(request.amount, subOrder.currency)} is on its way back to the account or wallet you paid with.`,
    });
  }
}

/**
 * Follow refunds Chapa has accepted until they finish. A reversed refund means
 * the money went back to the platform balance instead of the buyer; it is
 * kept for staff to resolve with the buyer. Run every few minutes.
 */
export async function reconcileRefunds(gateway: PaymentGateway, limit = 100): Promise<{ refunded: number; reversed: number }> {
  const open = await prisma.refund.findMany({
    where: { status: "PROCESSING", providerRefundId: { not: null } },
    orderBy: { createdAt: "asc" },
    take: limit,
    select: { id: true, providerRefundId: true, payment: { select: { id: true, amount: true } } },
  });
  let refunded = 0;
  let reversed = 0;
  for (const row of open) {
    try {
      const result = await gateway.verifyRefund(row.providerRefundId ?? "");
      if (!result || result.state === "PROCESSING") continue;
      await prisma.$transaction(async (tx) => {
        await tx.refund.update({
          where: { id: row.id },
          data: { status: result.state, failureReason: result.state === "REVERSED" ? "Chapa reversed the refund; the money is back in the platform balance." : null },
        });
        await syncPaymentRefundState(tx, row.payment);
      });
      if (result.state === "REFUNDED") refunded += 1;
      else {
        reversed += 1;
        console.error(`[refunds] Chapa reversed refund ${row.providerRefundId}; staff must settle it with the buyer`);
      }
    } catch (error) {
      console.error(`[refunds] could not check refund ${row.providerRefundId}`, error);
    }
  }
  return { refunded, reversed };
}
