import type Stripe from "stripe";
import { prisma } from "@marketplace/database";
import { CheckoutError } from "./errors";
import { rollupOrderStatus } from "./fulfillment";
import { accounts, postEntry } from "./ledger";
import { displayAmount, notifySubOrder } from "./notifications";

/**
 * Escrow lifecycle per sub-order:
 *   HELD ──release──▶ RELEASED ──transfer──▶ (stripeTransferId set)
 *   HELD ──chargeback/dispute──▶ FROZEN ──resolution──▶ HELD | REFUNDED
 *
 * Release moves the store's money from escrow to payable in the ledger; the
 * Stripe transfer to the connected account then settles payable against cash.
 */

const OPEN_DISPUTES = ["OPEN", "AWAITING_SELLER", "AWAITING_BUYER", "UNDER_REVIEW"] as const;

/** Release one escrow now. Returns false when it was not HELD (already released, frozen or refunded). */
export async function releaseEscrowNow(escrowId: string, now: Date, reason: string): Promise<boolean> {
  const released = await prisma.$transaction(async (tx) => {
    const escrow = await tx.escrow.findUnique({
      where: { id: escrowId },
      select: { id: true, amount: true, refunded: true, subOrder: { select: { id: true, orderId: true, storeId: true, currency: true, status: true } } },
    });
    if (!escrow) return null;
    // Partial refunds already came out of escrow; the store receives the rest.
    const net = Math.max(0, escrow.amount - escrow.refunded);
    const claimed = await tx.escrow.updateMany({ where: { id: escrow.id, status: "HELD" }, data: { status: "RELEASED", released: net, releasedAt: now } });
    if (claimed.count === 0) return null;

    const { subOrder } = escrow;
    if (net > 0) {
      await postEntry(tx, {
        idempotencyKey: `escrow-release:${escrow.id}`,
        description: `Escrow released for sub-order ${subOrder.id} (${reason})`,
        occurredAt: now,
        metadata: { escrowId: escrow.id, subOrderId: subOrder.id, reason },
        lines: [
          { account: accounts.escrow(subOrder.storeId, subOrder.currency), direction: "DEBIT", amount: net },
          { account: accounts.payable(subOrder.storeId, subOrder.currency), direction: "CREDIT", amount: net },
        ],
      });
    }
    if (subOrder.status === "DELIVERED" || subOrder.status === "SHIPPED" || subOrder.status === "SUBMITTED") {
      await tx.subOrder.update({ where: { id: subOrder.id }, data: { status: "COMPLETED", completedAt: now } });
      await tx.orderItem.updateMany({ where: { subOrderId: subOrder.id, status: { in: ["DELIVERED", "PENDING", "FULFILLING"] } }, data: { status: "COMPLETED", completedAt: now } });
    }
    // Approved work, and delivered work the buyer never answered, is now paid.
    await tx.milestone.updateMany({ where: { orderItem: { subOrderId: subOrder.id }, status: { in: ["SUBMITTED", "APPROVED"] } }, data: { status: "RELEASED", releasedAt: now } });
    await rollupOrderStatus(tx, subOrder.orderId);
    return { subOrderId: subOrder.id, net, currency: subOrder.currency };
  });
  if (!released) return false;
  await notifySubOrder(released.subOrderId, "seller", {
    type: "ESCROW_RELEASED",
    title: "Payment released for order {order}",
    body: `${displayAmount(released.net, released.currency)} moved to your balance and will be paid out to your bank.`,
  });
  return true;
}

/** Release every escrow past its hold date whose goods or work were delivered and that has no open dispute. */
export async function releaseEligibleEscrows(now: Date, limit = 200): Promise<number> {
  const eligible = await prisma.escrow.findMany({
    where: {
      status: "HELD",
      holdUntil: { lte: now },
      subOrder: { status: { in: ["DELIVERED", "COMPLETED"] }, disputes: { none: { status: { in: [...OPEN_DISPUTES] } } } },
    },
    orderBy: { holdUntil: "asc" },
    take: limit,
    select: { id: true },
  });
  let released = 0;
  for (const escrow of eligible) {
    try {
      if (await releaseEscrowNow(escrow.id, now, "hold period ended")) released += 1;
    } catch (error) {
      console.error(`[escrow] could not release ${escrow.id}`, error);
    }
  }
  return released;
}

/**
 * Transfer released escrow to sellers' connected accounts. The charge may
 * have settled in another currency (e.g. ETB charged, USD balance); the
 * transfer uses the settlement currency, in proportion to the charge.
 */
export async function transferPendingPayouts(stripe: Stripe, limit = 100): Promise<number> {
  const pending = await prisma.escrow.findMany({
    where: { status: "RELEASED", stripeTransferId: null, released: { gt: 0 }, subOrder: { store: { payoutsEnabled: true, stripeAccountId: { not: null } } } },
    take: limit,
    select: {
      id: true,
      released: true,
      subOrder: {
        select: {
          id: true,
          currency: true,
          storeId: true,
          orderId: true,
          store: { select: { stripeAccountId: true } },
          order: { select: { payments: { where: { status: { in: ["SUCCEEDED", "PARTIALLY_REFUNDED"] } }, select: { stripeChargeId: true }, take: 1 } } },
        },
      },
    },
  });

  let transferred = 0;
  for (const escrow of pending) {
    const { subOrder } = escrow;
    const chargeId = subOrder.order.payments[0]?.stripeChargeId;
    const destination = subOrder.store.stripeAccountId;
    if (!chargeId || !destination) continue;
    try {
      const charge = await stripe.charges.retrieve(chargeId, { expand: ["balance_transaction"] });
      const balance = charge.balance_transaction;
      if (!balance || typeof balance === "string") throw new Error(`Charge ${chargeId} has no balance transaction yet`);
      const amount = Math.floor((escrow.released * balance.amount) / charge.amount);
      if (amount <= 0) continue;

      const transfer = await stripe.transfers.create(
        {
          amount,
          currency: balance.currency,
          destination,
          transfer_group: subOrder.orderId,
          source_transaction: chargeId,
          metadata: { escrowId: escrow.id, subOrderId: subOrder.id },
        },
        { idempotencyKey: `escrow-transfer-${escrow.id}` },
      );

      await prisma.$transaction(async (tx) => {
        const marked = await tx.escrow.updateMany({ where: { id: escrow.id, stripeTransferId: null }, data: { stripeTransferId: transfer.id } });
        if (marked.count === 0) return;
        await postEntry(tx, {
          idempotencyKey: `escrow-transfer:${escrow.id}`,
          description: `Transfer ${transfer.id} to store ${subOrder.storeId}`,
          occurredAt: new Date(),
          metadata: { escrowId: escrow.id, transferId: transfer.id, settlementAmount: amount, settlementCurrency: balance.currency },
          lines: [
            { account: accounts.payable(subOrder.storeId, subOrder.currency), direction: "DEBIT", amount: escrow.released },
            { account: accounts.cash(subOrder.currency), direction: "CREDIT", amount: escrow.released },
          ],
        });
      });
      transferred += 1;
    } catch (error) {
      console.error(`[escrow] transfer for ${escrow.id} failed`, error);
    }
  }
  return transferred;
}

/** Chargeback or dispute: stop any money leaving for this order. */
export async function freezeOrderEscrows(orderId: string, reason: string, now: Date): Promise<number> {
  const frozen = await prisma.escrow.updateMany({
    where: { status: "HELD", subOrder: { orderId } },
    data: { status: "FROZEN", frozenAt: now, frozenReason: reason.slice(0, 300) },
  });
  return frozen.count;
}

export async function unfreezeOrderEscrows(orderId: string): Promise<number> {
  const thawed = await prisma.escrow.updateMany({ where: { status: "FROZEN", subOrder: { orderId } }, data: { status: "HELD", frozenAt: null, frozenReason: null } });
  return thawed.count;
}

/** The buyer confirms delivery: the sub-order completes and its escrow is released immediately. */
export async function confirmReceived(buyerId: string, subOrderId: string, now: Date): Promise<void> {
  const subOrder = await prisma.subOrder.findFirst({
    where: { id: subOrderId, order: { buyerId } },
    select: { id: true, status: true, escrow: { select: { id: true, status: true } }, disputes: { where: { status: { in: [...OPEN_DISPUTES] } }, select: { id: true } } },
  });
  if (!subOrder) throw new CheckoutError("That order does not exist.");
  if (!["SHIPPED", "DELIVERED"].includes(subOrder.status)) throw new CheckoutError("You can confirm once the seller has shipped or delivered.");
  if (subOrder.disputes.length > 0) throw new CheckoutError("This order has an open dispute.");
  if (!subOrder.escrow || subOrder.escrow.status !== "HELD") throw new CheckoutError("Payment for this order has already been settled.");
  const unfinishedWork = await prisma.orderItem.count({ where: { subOrderId: subOrder.id, listingType: "SERVICE", status: { in: ["PENDING", "FULFILLING"] } } });
  if (unfinishedWork > 0) throw new CheckoutError("Part of this order is service work that is not delivered yet. Approve it in the workspace once it is.");
  await prisma.subOrder.update({ where: { id: subOrder.id }, data: { status: "DELIVERED", deliveredAt: now } });
  await releaseEscrowNow(subOrder.escrow.id, now, "buyer confirmed delivery");
}
