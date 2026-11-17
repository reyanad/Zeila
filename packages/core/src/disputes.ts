import type Stripe from "stripe";
import { prisma, type DisputeParty, type DisputeReason, type DisputeStatus } from "@marketplace/database";
import { DISPUTE_REASONS, DISPUTE_RESPONSE_DAYS, isDisputeReason, screenMessage } from "@marketplace/shared-types";
import { CheckoutError } from "./errors";
import { releaseEscrowNow } from "./escrow";
import { freezeSubOrderEscrow, OPEN_DISPUTE_STATUSES, unfreezeSubOrderIfClear } from "./holds";
import { accounts, postEntry } from "./ledger";
import { displayAmount, notify, type NotifyInput } from "./notifications";
import { allocate } from "./pricing";
import { refundSubOrder } from "./refunds";
import type { AttachmentRef } from "./services";

/**
 * Resolution center. A buyer's claim freezes the sub-order's escrow and goes
 * back and forth between buyer and seller (each has DISPUTE_RESPONSE_DAYS to
 * answer). The seller can propose a refund the buyer accepts; either side can
 * ask staff to decide. Card chargebacks are recorded as disputes too, and are
 * settled by the bank's decision.
 */

const DAY_MS = 86_400_000;
const OPEN: readonly DisputeStatus[] = OPEN_DISPUTE_STATUSES;

function isOpen(status: DisputeStatus): boolean {
  return OPEN.includes(status);
}

async function loadDispute(disputeId: string) {
  return prisma.dispute.findUnique({
    where: { id: disputeId },
    select: {
      id: true,
      kind: true,
      status: true,
      createdAt: true,
      subOrderId: true,
      subOrder: {
        select: {
          id: true,
          orderId: true,
          grandTotal: true,
          refundedTotal: true,
          currency: true,
          order: { select: { buyerId: true, orderNumber: true } },
          store: { select: { sellerId: true, name: true } },
          items: { select: { id: true } },
        },
      },
    },
  });
}

type LoadedDispute = NonNullable<Awaited<ReturnType<typeof loadDispute>>>;

/** The caller's side in a dispute, or an error if they have none. */
export async function disputeAccess(userId: string, disputeId: string, isStaff: boolean): Promise<{ dispute: LoadedDispute; party: DisputeParty }> {
  const dispute = await loadDispute(disputeId);
  if (!dispute) throw new CheckoutError("That case does not exist.");
  const party: DisputeParty | null =
    dispute.subOrder.order.buyerId === userId ? "BUYER" : dispute.subOrder.store.sellerId === userId ? "SELLER" : isStaff ? "STAFF" : null;
  if (!party) throw new CheckoutError("That case does not exist.");
  return { dispute, party };
}

function caseLinks(dispute: LoadedDispute): { buyer: string; seller: string } {
  return { buyer: `/disputes/${dispute.id}`, seller: `/disputes/${dispute.id}` };
}

function notifyParties(dispute: LoadedDispute, to: Array<"buyer" | "seller">, input: Omit<NotifyInput, "userId" | "href">): Promise<void> {
  const links = caseLinks(dispute);
  return notify(
    to.map((side) => ({
      ...input,
      userId: side === "buyer" ? dispute.subOrder.order.buyerId : dispute.subOrder.store.sellerId,
      href: side === "buyer" ? links.buyer : links.seller,
    })),
  );
}

export interface OpenDisputeInput {
  subOrderId: string;
  orderItemId: string | null;
  reason: string;
  description: string;
  attachments: AttachmentRef[];
}

export async function openDispute(buyerId: string, input: OpenDisputeInput, now: Date): Promise<string> {
  const reason = input.reason;
  if (!isDisputeReason(reason)) throw new CheckoutError("Choose what went wrong.");
  const description = input.description.trim();
  if (description.length < 20) throw new CheckoutError("Describe the problem in a few sentences (at least 20 characters).");
  const subOrder = await prisma.subOrder.findFirst({
    where: { id: input.subOrderId, order: { buyerId } },
    select: { id: true, status: true, escrow: { select: { status: true } }, items: { select: { id: true } } },
  });
  if (!subOrder || subOrder.status === "PENDING_PAYMENT" || subOrder.status === "CANCELLED") throw new CheckoutError("That order does not exist.");
  if (!subOrder.escrow || (subOrder.escrow.status !== "HELD" && subOrder.escrow.status !== "FROZEN")) {
    throw new CheckoutError("The seller has already been paid for this order, so it can no longer be disputed here. Contact support.");
  }
  if (input.orderItemId && !subOrder.items.some((item) => item.id === input.orderItemId)) throw new CheckoutError("Choose an item from this order.");
  const open = await prisma.dispute.count({ where: { subOrderId: subOrder.id, status: { in: [...OPEN] } } });
  if (open > 0) throw new CheckoutError("There is already an open case for this order.");

  const dispute = await prisma.$transaction(async (tx) => {
    const created = await tx.dispute.create({
      data: {
        subOrderId: subOrder.id,
        orderItemId: input.orderItemId,
        openedById: buyerId,
        reason: reason as DisputeReason,
        description: description.slice(0, 5_000),
        status: "AWAITING_SELLER",
        respondBy: new Date(now.getTime() + DISPUTE_RESPONSE_DAYS * DAY_MS),
        messages: { create: { authorId: buyerId, party: "BUYER", body: screenMessage(description).text.slice(0, 5_000), attachments: input.attachments.map((file) => ({ ...file })), createdAt: now } },
      },
      select: { id: true },
    });
    await freezeSubOrderEscrow(tx, subOrder.id, `Dispute: ${DISPUTE_REASONS[reason]}`, now);
    return created;
  });
  const loaded = await loadDispute(dispute.id);
  if (loaded) {
    await notifyParties(loaded, ["seller"], {
      type: "DISPUTE_OPENED",
      title: `Case opened on order ${loaded.subOrder.order.orderNumber}`,
      body: `${DISPUTE_REASONS[reason]}. Reply within ${DISPUTE_RESPONSE_DAYS} days; your payment is on hold until the case is settled.`,
    });
  }
  return dispute.id;
}

export interface DisputeMessageInput {
  body: string;
  attachments: AttachmentRef[];
  /** Seller only: refund offered to settle, minor units. */
  proposal: number | null;
}

export async function postDisputeMessage(userId: string, isStaff: boolean, disputeId: string, input: DisputeMessageInput, now: Date): Promise<void> {
  const { dispute, party } = await disputeAccess(userId, disputeId, isStaff);
  if (!isOpen(dispute.status)) throw new CheckoutError("This case is closed.");
  const body = input.body.trim();
  if (!body && input.attachments.length === 0 && input.proposal === null) throw new CheckoutError("Write a message or attach evidence.");
  const remaining = dispute.subOrder.grandTotal - dispute.subOrder.refundedTotal;
  if (input.proposal !== null) {
    if (party !== "SELLER") throw new CheckoutError("Only the seller can offer a refund.");
    if (!Number.isInteger(input.proposal) || input.proposal < 1 || input.proposal > remaining) throw new CheckoutError(`Offer between 0.01 and ${displayAmount(remaining, dispute.subOrder.currency)}.`);
  }
  const underReview = dispute.status === "UNDER_REVIEW";
  const nextStatus: DisputeStatus = underReview || party === "STAFF" ? dispute.status : party === "BUYER" ? "AWAITING_SELLER" : "AWAITING_BUYER";
  await prisma.$transaction([
    prisma.disputeMessage.create({
      data: {
        disputeId,
        authorId: userId,
        party,
        body: (party === "STAFF" ? body : screenMessage(body).text).slice(0, 5_000),
        attachments: input.attachments.map((file) => ({ ...file })),
        proposal: input.proposal,
        createdAt: now,
      },
    }),
    prisma.dispute.update({
      where: { id: disputeId },
      data: { status: nextStatus, ...(underReview || party === "STAFF" ? {} : { respondBy: new Date(now.getTime() + DISPUTE_RESPONSE_DAYS * DAY_MS) }) },
    }),
  ]);
  const to: Array<"buyer" | "seller"> = party === "BUYER" ? ["seller"] : party === "SELLER" ? ["buyer"] : ["buyer", "seller"];
  await notifyParties(dispute, to, {
    type: "DISPUTE_UPDATED",
    title:
      input.proposal !== null
        ? `${dispute.subOrder.store.name} offered a ${displayAmount(input.proposal, dispute.subOrder.currency)} refund`
        : `New reply on your case for order ${dispute.subOrder.order.orderNumber}`,
    body: body.slice(0, 200) || null,
  });
}

/** After a decision that leaves money with the seller: lift the hold and pay out the rest now. */
async function settleRemainder(subOrderId: string, now: Date, reason: string): Promise<void> {
  await unfreezeSubOrderIfClear(subOrderId);
  const escrow = await prisma.escrow.findUnique({ where: { subOrderId }, select: { id: true, status: true } });
  if (!escrow || escrow.status !== "HELD") return;
  await prisma.$transaction(async (tx) => {
    await tx.subOrder.updateMany({ where: { id: subOrderId, status: { notIn: ["REFUNDED", "CANCELLED", "COMPLETED"] } }, data: { status: "COMPLETED", completedAt: now } });
    await tx.orderItem.updateMany({ where: { subOrderId, status: { in: ["PENDING", "FULFILLING", "DELIVERED"] } }, data: { status: "COMPLETED", completedAt: now } });
  });
  await releaseEscrowNow(escrow.id, now, reason);
}

async function finish(dispute: LoadedDispute, status: DisputeStatus, resolution: string, refundAmount: number | null, resolvedById: string | null, now: Date): Promise<void> {
  await prisma.dispute.update({ where: { id: dispute.id }, data: { status, resolution: resolution.slice(0, 2_000), refundAmount, resolvedById, resolvedAt: now, respondBy: null } });
  await notifyParties(dispute, ["buyer", "seller"], {
    type: "DISPUTE_RESOLVED",
    title: `Case closed for order ${dispute.subOrder.order.orderNumber}`,
    body: resolution.slice(0, 300),
  });
}

function refundRequest(dispute: LoadedDispute, amount: number, key: string, reason: string, external = false) {
  const remaining = dispute.subOrder.grandTotal - dispute.subOrder.refundedTotal;
  return {
    subOrderId: dispute.subOrderId,
    amount,
    reason,
    idempotencyKey: key,
    refundedItemIds: amount >= remaining ? dispute.subOrder.items.map((item) => item.id) : [],
    restock: [],
    external,
  };
}

/** The buyer accepts the seller's latest refund offer. */
export async function acceptDisputeProposal(stripe: Stripe | null, buyerId: string, disputeId: string, now: Date): Promise<void> {
  const { dispute, party } = await disputeAccess(buyerId, disputeId, false);
  if (party !== "BUYER") throw new CheckoutError("Only the buyer can accept an offer.");
  if (!isOpen(dispute.status)) throw new CheckoutError("This case is closed.");
  const offer = await prisma.disputeMessage.findFirst({ where: { disputeId, party: "SELLER", proposal: { not: null } }, orderBy: { createdAt: "desc" }, select: { proposal: true } });
  const amount = offer?.proposal ?? null;
  if (amount === null) throw new CheckoutError("The seller has not offered a refund.");
  const remaining = dispute.subOrder.grandTotal - dispute.subOrder.refundedTotal;
  const applied = Math.min(amount, remaining);
  await refundSubOrder(stripe, refundRequest(dispute, applied, `dispute:${dispute.id}`, `Dispute ${dispute.id} settled by agreement`), now);
  const full = applied >= remaining;
  await finish(dispute, full ? "RESOLVED_BUYER" : "RESOLVED_SPLIT", `Settled by agreement: ${displayAmount(applied, dispute.subOrder.currency)} refunded to the buyer.`, applied, null, now);
  if (!full) await settleRemainder(dispute.subOrderId, now, "dispute settled by agreement");
}

/** Either side asks staff to decide. */
export async function escalateDispute(userId: string, disputeId: string, now: Date): Promise<void> {
  const { dispute, party } = await disputeAccess(userId, disputeId, false);
  if (party === "STAFF") throw new CheckoutError("Staff decide from the resolution center.");
  if (!isOpen(dispute.status) || dispute.status === "UNDER_REVIEW") throw new CheckoutError("This case is already with the platform or closed.");
  const theirTurn = (party === "BUYER" && dispute.status === "AWAITING_BUYER") || (party === "SELLER" && dispute.status === "AWAITING_SELLER");
  if (!theirTurn && now.getTime() - dispute.createdAt.getTime() < DAY_MS) throw new CheckoutError("Give the other side a day to answer before asking the platform to step in.");
  await prisma.$transaction([
    prisma.dispute.update({ where: { id: disputeId }, data: { status: "UNDER_REVIEW", respondBy: null } }),
    prisma.disputeMessage.create({ data: { disputeId, party: "SYSTEM", body: `The ${party === "BUYER" ? "buyer" : "seller"} asked the platform to decide. A specialist will review the case.`, createdAt: now } }),
  ]);
  await notifyParties(dispute, [party === "BUYER" ? "seller" : "buyer"], {
    type: "DISPUTE_UPDATED",
    title: `The case for order ${dispute.subOrder.order.orderNumber} is now with the platform`,
    body: "Add any evidence you want the specialist to see.",
  });
}

export async function withdrawDispute(buyerId: string, disputeId: string, now: Date): Promise<void> {
  const { dispute, party } = await disputeAccess(buyerId, disputeId, false);
  if (party !== "BUYER") throw new CheckoutError("Only the buyer can withdraw the case.");
  if (dispute.kind !== "CLAIM") throw new CheckoutError("Card disputes are withdrawn with your bank.");
  if (!isOpen(dispute.status)) throw new CheckoutError("This case is closed.");
  await finish(dispute, "CLOSED", "Withdrawn by the buyer.", null, null, now);
  await unfreezeSubOrderIfClear(dispute.subOrderId);
}

/** Staff decision: refund anything from nothing up to what is left of the sub-order. */
export async function resolveDispute(stripe: Stripe | null, staffId: string, disputeId: string, input: { refundAmount: number; note: string }, now: Date): Promise<void> {
  const { dispute } = await disputeAccess(staffId, disputeId, true);
  if (dispute.kind !== "CLAIM") throw new CheckoutError("Card disputes are decided by the bank; submit evidence instead.");
  if (!isOpen(dispute.status)) throw new CheckoutError("This case is closed.");
  const note = input.note.trim();
  if (note.length < 10) throw new CheckoutError("Explain the decision to both sides (at least 10 characters).");
  const remaining = dispute.subOrder.grandTotal - dispute.subOrder.refundedTotal;
  if (!Number.isInteger(input.refundAmount) || input.refundAmount < 0 || input.refundAmount > remaining) {
    throw new CheckoutError(`Refund between 0 and ${displayAmount(remaining, dispute.subOrder.currency)}.`);
  }
  await prisma.disputeMessage.create({ data: { disputeId, authorId: staffId, party: "STAFF", body: note.slice(0, 5_000), createdAt: now } });
  if (input.refundAmount > 0) await refundSubOrder(stripe, refundRequest(dispute, input.refundAmount, `dispute:${dispute.id}`, `Dispute ${dispute.id} decided by staff`), now);
  const status: DisputeStatus = input.refundAmount === 0 ? "RESOLVED_SELLER" : input.refundAmount >= remaining ? "RESOLVED_BUYER" : "RESOLVED_SPLIT";
  await finish(dispute, status, note, input.refundAmount, staffId, now);
  if (input.refundAmount < remaining) await settleRemainder(dispute.subOrderId, now, "dispute decided by staff");
}

/** Worker: unanswered sellers go to staff review; unanswered buyers close the case. */
export async function processDisputeDeadlines(now: Date): Promise<{ escalated: number; closed: number }> {
  const overdue = await prisma.dispute.findMany({
    where: { kind: "CLAIM", status: { in: ["AWAITING_SELLER", "AWAITING_BUYER"] }, respondBy: { lt: now } },
    select: { id: true, status: true },
    take: 200,
  });
  let escalated = 0;
  let closed = 0;
  for (const candidate of overdue) {
    const dispute = await loadDispute(candidate.id);
    if (!dispute) continue;
    if (candidate.status === "AWAITING_SELLER") {
      const updated = await prisma.dispute.updateMany({ where: { id: dispute.id, status: "AWAITING_SELLER" }, data: { status: "UNDER_REVIEW", respondBy: null } });
      if (updated.count === 0) continue;
      await prisma.disputeMessage.create({ data: { disputeId: dispute.id, party: "SYSTEM", body: "The seller did not reply in time, so the platform will decide.", createdAt: now } });
      await notifyParties(dispute, ["buyer", "seller"], { type: "DISPUTE_UPDATED", title: `The case for order ${dispute.subOrder.order.orderNumber} is now with the platform`, body: "The seller did not reply in time." });
      escalated += 1;
    } else {
      const updated = await prisma.dispute.updateMany({ where: { id: dispute.id, status: "AWAITING_BUYER" }, data: { status: "CLOSED", resolution: "Closed: the buyer did not reply in time.", resolvedAt: now, respondBy: null } });
      if (updated.count === 0) continue;
      await unfreezeSubOrderIfClear(dispute.subOrderId);
      await notifyParties(dispute, ["buyer", "seller"], { type: "DISPUTE_RESOLVED", title: `Case closed for order ${dispute.subOrder.order.orderNumber}`, body: "The buyer did not reply in time." });
      closed += 1;
    }
  }
  return { escalated, closed };
}

// ---------------------------------------------------------------------------
// Chargebacks
// ---------------------------------------------------------------------------

const CHARGEBACK_REASONS: Record<string, DisputeReason> = {
  fraudulent: "UNAUTHORIZED",
  unrecognized: "UNAUTHORIZED",
  product_not_received: "NOT_RECEIVED",
  product_unacceptable: "NOT_AS_DESCRIBED",
  subscription_canceled: "OTHER",
  duplicate: "OTHER",
  credit_not_processed: "OTHER",
  general: "OTHER",
};

export interface ChargebackOpened {
  orderId: string;
  stripeDisputeId: string;
  reason: string;
  amount: number;
  currency: string;
  evidenceDueBy: Date | null;
}

export async function recordChargeback(input: ChargebackOpened, now: Date): Promise<number> {
  const order = await prisma.order.findUnique({ where: { id: input.orderId }, select: { buyerId: true, orderNumber: true, subOrders: { select: { id: true } } } });
  if (!order) return 0;
  const reason = CHARGEBACK_REASONS[input.reason] ?? "OTHER";
  const description = `The card holder disputed the payment with their bank (${input.reason.replace(/_/g, " ")}), ${displayAmount(input.amount, input.currency)}.`;
  for (const subOrder of order.subOrders) {
    await prisma.$transaction(async (tx) => {
      const existing = await tx.dispute.findUnique({ where: { stripeDisputeId_subOrderId: { stripeDisputeId: input.stripeDisputeId, subOrderId: subOrder.id } }, select: { id: true } });
      if (existing) {
        await tx.dispute.update({ where: { id: existing.id }, data: { evidenceDueBy: input.evidenceDueBy } });
        return;
      }
      await tx.dispute.create({
        data: {
          kind: "CHARGEBACK",
          stripeDisputeId: input.stripeDisputeId,
          subOrderId: subOrder.id,
          openedById: order.buyerId,
          reason,
          description,
          status: "UNDER_REVIEW",
          evidenceDueBy: input.evidenceDueBy,
          messages: { create: { party: "SYSTEM", body: description, createdAt: now } },
        },
      });
      await freezeSubOrderEscrow(tx, subOrder.id, `Chargeback ${input.stripeDisputeId}`, now);
    });
  }
  const sellers = await prisma.subOrder.findMany({ where: { orderId: input.orderId }, select: { store: { select: { sellerId: true } } } });
  const due = input.evidenceDueBy ? ` Send evidence by ${input.evidenceDueBy.toISOString().slice(0, 10)}.` : "";
  await notify(
    sellers.map((row) => ({
      userId: row.store.sellerId,
      type: "DISPUTE_OPENED" as const,
      title: `Card dispute on order ${order.orderNumber}`,
      body: `Your payment is on hold while the buyer's bank reviews the payment.${due}`,
      href: "/disputes",
    })),
  );
  return order.subOrders.length;
}

/** The bank's decision. Lost: the money already left, so the buyer's share is taken back from escrow (or booked as a loss to recover). */
export async function closeChargeback(input: { stripeDisputeId: string; outcome: string; amount: number }, now: Date): Promise<void> {
  const disputes = await prisma.dispute.findMany({
    where: { stripeDisputeId: input.stripeDisputeId, kind: "CHARGEBACK", status: { in: [...OPEN] } },
    select: { id: true },
  });
  const loaded = (await Promise.all(disputes.map((row) => loadDispute(row.id)))).filter((row): row is LoadedDispute => row !== null);
  if (loaded.length === 0) return;

  if (input.outcome !== "lost") {
    for (const dispute of loaded) {
      await finish(dispute, "RESOLVED_SELLER", "The bank decided in the seller's favour; the payment stands.", 0, null, now);
      await unfreezeSubOrderIfClear(dispute.subOrderId);
    }
    return;
  }

  const shares = allocate(
    input.amount,
    loaded.map((dispute) => Math.max(0, dispute.subOrder.grandTotal - dispute.subOrder.refundedTotal)),
  );
  for (const [index, dispute] of loaded.entries()) {
    const share = shares[index] ?? 0;
    const escrow = await prisma.escrow.findUnique({ where: { subOrderId: dispute.subOrderId }, select: { status: true } });
    if (share > 0 && escrow && (escrow.status === "HELD" || escrow.status === "FROZEN")) {
      await refundSubOrder(null, refundRequest(dispute, share, `chargeback:${input.stripeDisputeId}:${dispute.subOrderId}`, `Chargeback ${input.stripeDisputeId} lost`, true), now);
    } else if (share > 0) {
      // The seller was already paid: the platform carries the loss until it is recovered.
      await prisma.$transaction(async (tx) => {
        await postEntry(tx, {
          idempotencyKey: `chargeback-loss:${input.stripeDisputeId}:${dispute.subOrderId}`,
          description: `Chargeback ${input.stripeDisputeId} lost after payout for sub-order ${dispute.subOrderId}`,
          occurredAt: now,
          metadata: { subOrderId: dispute.subOrderId, stripeDisputeId: input.stripeDisputeId, recoverFromStore: true },
          lines: [
            { account: accounts.chargebacks(dispute.subOrder.currency), direction: "DEBIT", amount: share },
            { account: accounts.cash(dispute.subOrder.currency), direction: "CREDIT", amount: share },
          ],
        });
      });
    }
    await finish(dispute, "RESOLVED_BUYER", `The bank decided in the card holder's favour; ${displayAmount(share, dispute.subOrder.currency)} was returned to them.`, share, null, now);
  }
}
