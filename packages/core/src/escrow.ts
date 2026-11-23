import { randomBytes } from "node:crypto";
import { prisma } from "@marketplace/database";
import { APP_NAME } from "@marketplace/shared-types";
import { CheckoutError } from "./errors";
import { decryptAtRest } from "./field-crypto";
import type { PaymentGateway } from "./gateway";
import { rollupOrderStatus } from "./fulfillment";
import { accounts, postEntry } from "./ledger";
import { displayAmount, notify, notifySubOrder } from "./notifications";

/**
 * Escrow lifecycle per sub-order:
 *   HELD ──release──▶ RELEASED ──Chapa transfer──▶ (payoutId set; Payout PAID when it lands)
 *   HELD ──chargeback/dispute──▶ FROZEN ──resolution──▶ HELD | REFUNDED
 *
 * Release moves the store's money from escrow to payable in the ledger; the
 * Chapa transfer to the seller's bank or wallet then settles payable against cash.
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

const PAYOUT_FAILURE_LIMIT = 3;

class PayoutSkipped extends Error {}

function payoutReference(): string {
  return `po-${randomBytes(9).toString("hex")}`;
}

/**
 * Pay released escrow to sellers by Chapa transfer, one transfer per released
 * sub-order. Payout row, escrow link and ledger entry (payable -> cash) are
 * written together before Chapa is called, so the books always show money
 * that is committed to leave; if Chapa refuses, the entry is reversed and the
 * escrow becomes payable again. Run every few minutes.
 */
export async function transferPendingPayouts(gateway: PaymentGateway, now: Date, limit = 100): Promise<number> {
  const pending = await prisma.escrow.findMany({
    where: {
      status: "RELEASED",
      payoutId: null,
      released: { gt: 0 },
      subOrder: { store: { payoutsEnabled: true, payoutBankId: { not: null }, payoutAccountNumber: { not: null }, payoutAccountName: { not: null } } },
    },
    orderBy: { releasedAt: "asc" },
    take: limit,
    select: {
      id: true,
      released: true,
      subOrder: {
        select: {
          id: true,
          currency: true,
          storeId: true,
          store: { select: { payoutBankId: true, payoutBankName: true, payoutAccountName: true, payoutAccountNumber: true, payoutAccountLast4: true } },
        },
      },
    },
  });

  let queued = 0;
  for (const escrow of pending) {
    const { subOrder } = escrow;
    const { store } = subOrder;
    if (!store.payoutBankId || !store.payoutAccountNumber || !store.payoutAccountName) continue;
    let accountNumber: string;
    try {
      accountNumber = decryptAtRest(store.payoutAccountNumber);
    } catch (error) {
      console.error(`[payouts] cannot read the payout account of store ${subOrder.storeId}`, error);
      continue;
    }

    const reference = payoutReference();
    let payoutId: string;
    try {
      payoutId = await prisma.$transaction(async (tx) => {
        const payout = await tx.payout.create({
          data: {
            storeId: subOrder.storeId,
            amount: escrow.released,
            currency: subOrder.currency,
            status: "PENDING",
            reference,
            bankName: store.payoutBankName,
            accountLast4: store.payoutAccountLast4,
          },
          select: { id: true },
        });
        const linked = await tx.escrow.updateMany({ where: { id: escrow.id, status: "RELEASED", payoutId: null }, data: { payoutId: payout.id } });
        if (linked.count === 0) throw new PayoutSkipped();
        await postEntry(tx, {
          idempotencyKey: `payout:${reference}`,
          description: `Chapa transfer ${reference} to store ${subOrder.storeId}`,
          occurredAt: now,
          metadata: { escrowId: escrow.id, subOrderId: subOrder.id, payoutId: payout.id, reference },
          lines: [
            { account: accounts.payable(subOrder.storeId, subOrder.currency), direction: "DEBIT", amount: escrow.released },
            { account: accounts.cash(subOrder.currency), direction: "CREDIT", amount: escrow.released },
          ],
        });
        return payout.id;
      });
    } catch (error) {
      if (error instanceof PayoutSkipped) continue;
      console.error(`[payouts] could not prepare the payout for escrow ${escrow.id}`, error);
      continue;
    }

    try {
      const result = await gateway.transfer({
        reference,
        amount: escrow.released,
        currency: subOrder.currency,
        bankId: store.payoutBankId,
        accountName: store.payoutAccountName,
        accountNumber,
      });
      if (result.kind === "queued") {
        await prisma.payout.update({ where: { id: payoutId }, data: { status: "IN_TRANSIT", providerTransferId: result.transferId } });
        queued += 1;
      } else {
        await failPayout(payoutId, `Chapa refused the transfer: ${result.message}`, !result.retryable, now);
      }
    } catch (error) {
      // Unknown outcome: the payout stays PENDING and reconcilePayouts asks Chapa about it.
      console.error(`[payouts] transfer ${reference} did not complete`, error);
    }
  }
  return queued;
}

/**
 * A transfer did not happen: reverse its ledger entry and make the escrow
 * payable again so the next run retries it. After repeated failures (or a
 * refusal that points at the account details) the store's payouts are paused
 * until the seller checks their payout account.
 */
async function failPayout(payoutId: string, reason: string, accountProblem: boolean, now: Date): Promise<void> {
  const outcome = await prisma.$transaction(async (tx) => {
    const payout = await tx.payout.findUnique({ where: { id: payoutId }, select: { id: true, status: true, reference: true, storeId: true, amount: true, currency: true } });
    if (!payout || (payout.status !== "PENDING" && payout.status !== "IN_TRANSIT")) return null;
    await tx.payout.update({ where: { id: payout.id }, data: { status: "FAILED", failureReason: reason.slice(0, 500) } });
    await postEntry(tx, {
      idempotencyKey: `payout-reversal:${payout.reference}`,
      description: `Chapa transfer ${payout.reference} failed; money is payable to the store again`,
      occurredAt: now,
      metadata: { payoutId: payout.id, reason: reason.slice(0, 300) },
      lines: [
        { account: accounts.cash(payout.currency), direction: "DEBIT", amount: payout.amount },
        { account: accounts.payable(payout.storeId, payout.currency), direction: "CREDIT", amount: payout.amount },
      ],
    });
    await tx.escrow.updateMany({ where: { payoutId: payout.id }, data: { payoutId: null } });
    const recentFailures = await tx.payout.count({ where: { storeId: payout.storeId, status: "FAILED", updatedAt: { gte: new Date(now.getTime() - 86_400_000) } } });
    const pause = accountProblem || recentFailures >= PAYOUT_FAILURE_LIMIT;
    if (pause) await tx.store.update({ where: { id: payout.storeId }, data: { payoutsEnabled: false } });
    const store = await tx.store.findUniqueOrThrow({ where: { id: payout.storeId }, select: { sellerId: true } });
    return { pause, sellerId: store.sellerId };
  });
  if (outcome?.pause) {
    await notify({
      userId: outcome.sellerId,
      type: "PAYOUT_SENT",
      title: "Your payout could not be sent",
      body: `Chapa could not deliver your earnings to the account on file. Check your payout account in Seller setup; your money stays safe on ${APP_NAME} until then.`,
      href: "/seller/onboarding",
    });
  }
}

async function markPayoutPaid(payoutId: string, now: Date): Promise<void> {
  const payout = await prisma.payout.findUnique({ where: { id: payoutId }, select: { id: true, status: true, amount: true, currency: true, bankName: true, accountLast4: true, store: { select: { sellerId: true } } } });
  if (!payout || (payout.status !== "PENDING" && payout.status !== "IN_TRANSIT")) return;
  const marked = await prisma.payout.updateMany({ where: { id: payout.id, status: { in: ["PENDING", "IN_TRANSIT"] } }, data: { status: "PAID", paidAt: now, arrivalAt: now } });
  if (marked.count === 0) return;
  const destination = [payout.bankName, payout.accountLast4 ? `ending ${payout.accountLast4}` : null].filter(Boolean).join(" ");
  await notify({
    userId: payout.store.sellerId,
    type: "PAYOUT_SENT",
    title: `Payout sent: ${displayAmount(payout.amount, payout.currency)}`,
    body: destination ? `Sent to ${destination}.` : "Sent to your payout account.",
    href: "/seller/studio/analytics",
  });
}

/** Ask Chapa about one transfer and apply the answer. Used by the sweep and by payout webhooks. */
export async function refreshPayout(gateway: PaymentGateway, reference: string, now: Date): Promise<void> {
  const payout = await prisma.payout.findUnique({ where: { reference }, select: { id: true, status: true, createdAt: true } });
  if (!payout || (payout.status !== "PENDING" && payout.status !== "IN_TRANSIT")) return;
  const result = await gateway.verifyTransfer(reference);
  if (result.status === "success") await markPayoutPaid(payout.id, now);
  else if (result.status === "failed") await failPayout(payout.id, `Chapa reported the transfer failed${result.message ? `: ${result.message}` : ""}`, false, now);
  else if (result.status === "not_found" && payout.status === "PENDING" && now.getTime() - payout.createdAt.getTime() > 10 * 60_000) {
    // Chapa never received it: undo and let the next run send a fresh transfer.
    await failPayout(payout.id, "Chapa has no record of this transfer", false, now);
  }
}

/** Follow transfers that are queued or whose outcome was unknown. Run every few minutes. */
export async function reconcilePayouts(gateway: PaymentGateway, now: Date, limit = 100): Promise<number> {
  const open = await prisma.payout.findMany({
    where: { status: { in: ["PENDING", "IN_TRANSIT"] }, updatedAt: { lt: new Date(now.getTime() - 2 * 60_000) } },
    orderBy: { updatedAt: "asc" },
    take: limit,
    select: { reference: true },
  });
  let checked = 0;
  for (const payout of open) {
    try {
      await refreshPayout(gateway, payout.reference, now);
      checked += 1;
    } catch (error) {
      console.error(`[payouts] could not check transfer ${payout.reference}`, error);
    }
  }
  return checked;
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
