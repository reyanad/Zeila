import type Stripe from "stripe";
import { prisma } from "@marketplace/database";
import { isReturnReason, RETURN_REASONS } from "@marketplace/shared-types";
import { orderItemForUser, sellerSubOrderId } from "./access";
import { CheckoutError } from "./errors";
import { freezeSubOrderEscrow, OPEN_RETURN_STATUSES, unfreezeSubOrderIfClear } from "./holds";
import { notifySubOrder } from "./notifications";
import { refundSubOrder } from "./refunds";

/**
 * Returns (RMA). A buyer can ask to return delivered physical items while the
 * sub-order's escrow is still held (the protection window). Opening a return
 * freezes the escrow; the refund comes out of it.
 */

const OPEN_RMA = OPEN_RETURN_STATUSES;

export async function requestReturn(buyerId: string, orderItemId: string, input: { reason: string; details: string; quantity: number }, now: Date): Promise<string> {
  const { item, role } = await orderItemForUser(buyerId, orderItemId);
  if (role !== "buyer") throw new CheckoutError("Only the buyer can request a return.");
  if (item.listingType !== "PHYSICAL") throw new CheckoutError("Returns apply to physical products. For downloads and services, open a dispute.");
  if (item.status !== "DELIVERED") throw new CheckoutError("You can request a return once the item has been delivered.");
  const reason = input.reason;
  if (!isReturnReason(reason)) throw new CheckoutError("Choose a reason.");
  if (!Number.isInteger(input.quantity) || input.quantity < 1 || input.quantity > item.quantity) throw new CheckoutError(`Choose between 1 and ${item.quantity}.`);

  const escrow = await prisma.escrow.findUnique({ where: { subOrderId: item.subOrderId }, select: { id: true, status: true } });
  if (!escrow || escrow.status === "RELEASED" || escrow.status === "REFUNDED") {
    throw new CheckoutError("The return window has closed and the seller has been paid. Open a dispute if there is a problem.");
  }
  const open = await prisma.rmaRequest.count({ where: { orderItemId: item.id, status: { in: [...OPEN_RMA] } } });
  if (open > 0) throw new CheckoutError("You already have an open return for this item.");

  const rma = await prisma.$transaction(async (tx) => {
    const created = await tx.rmaRequest.create({
      data: { orderItemId: item.id, requesterId: buyerId, reason, details: input.details.slice(0, 2000) || null, quantity: input.quantity },
      select: { id: true },
    });
    await freezeSubOrderEscrow(tx, item.subOrderId, `Return requested: ${RETURN_REASONS[reason]}`, now);
    return created;
  });
  await notifySubOrder(item.subOrderId, "seller", { type: "RETURN_REQUESTED", title: "Return requested on order {order}", body: `${item.titleSnapshot}: ${RETURN_REASONS[reason]}` });
  return rma.id;
}

async function sellerRma(sellerUserId: string, rmaId: string) {
  const rma = await prisma.rmaRequest.findFirst({
    where: { id: rmaId, orderItem: { subOrder: { store: { sellerId: sellerUserId } } } },
    select: { id: true, status: true, quantity: true, orderItem: { select: { id: true, subOrderId: true, quantity: true, lineTotal: true } } },
  });
  if (!rma) throw new CheckoutError("That return does not exist.");
  await sellerSubOrderId(sellerUserId, rma.orderItem.subOrderId);
  return rma;
}

export async function decideReturn(sellerUserId: string, rmaId: string, approve: boolean, note: string, now: Date): Promise<void> {
  const rma = await sellerRma(sellerUserId, rmaId);
  if (rma.status !== "REQUESTED") throw new CheckoutError("This return was already answered.");
  await prisma.rmaRequest.update({
    where: { id: rma.id },
    data: approve ? { status: "APPROVED", sellerNote: note || null, decidedAt: now } : { status: "REJECTED", resolution: "REJECTED", sellerNote: note || null, decidedAt: now },
  });
  if (!approve) await unfreezeSubOrderIfClear(rma.orderItem.subOrderId);
  await notifySubOrder(rma.orderItem.subOrderId, "buyer", {
    type: "RETURN_UPDATED",
    title: approve ? "{store} approved your return" : "{store} declined your return",
    body: note || (approve ? "Send the item back and add the tracking number on your order page." : "Open a dispute from your order page if you disagree."),
  });
}

export async function submitReturnTracking(buyerId: string, rmaId: string, trackingNumber: string): Promise<void> {
  const rma = await prisma.rmaRequest.findFirst({ where: { id: rmaId, requesterId: buyerId }, select: { id: true, status: true } });
  if (!rma) throw new CheckoutError("That return does not exist.");
  if (rma.status !== "APPROVED") throw new CheckoutError("Wait for the seller to approve the return first.");
  await prisma.rmaRequest.update({ where: { id: rma.id }, data: { status: "AWAITING_RETURN", returnTrackingNumber: trackingNumber.slice(0, 60) } });
}

/** Seller received the goods back (or refunds without a return): refund and optionally restock. */
export async function completeReturn(stripe: Stripe | null, sellerUserId: string, rmaId: string, input: { refundAmount: number; restock: boolean }, now: Date): Promise<void> {
  const rma = await sellerRma(sellerUserId, rmaId);
  if (!["APPROVED", "AWAITING_RETURN", "RECEIVED"].includes(rma.status)) throw new CheckoutError("This return cannot be refunded in its current state.");
  const fullItem = rma.quantity === rma.orderItem.quantity;
  await refundSubOrder(
    stripe,
    {
      subOrderId: rma.orderItem.subOrderId,
      amount: input.refundAmount,
      reason: `Return ${rma.id}`,
      idempotencyKey: `rma:${rma.id}`,
      refundedItemIds: fullItem ? [rma.orderItem.id] : [],
      restock: input.restock ? [{ orderItemId: rma.orderItem.id, quantity: rma.quantity }] : [],
    },
    now,
  );
  await prisma.rmaRequest.update({ where: { id: rma.id }, data: { status: "REFUNDED", resolution: "REFUND", refundAmount: input.refundAmount, decidedAt: now } });
  await unfreezeSubOrderIfClear(rma.orderItem.subOrderId);
}

/** Largest refund a return can carry: the returned share of the item, never more than what is left. */
export function suggestedReturnRefund(lineTotal: number, itemQuantity: number, returnQuantity: number): number {
  return Math.floor((lineTotal * returnQuantity) / itemQuantity);
}
