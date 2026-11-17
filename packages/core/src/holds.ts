import { prisma, type Prisma } from "@marketplace/database";

export const OPEN_RETURN_STATUSES = ["REQUESTED", "APPROVED", "AWAITING_RETURN", "RECEIVED"] as const;
export const OPEN_DISPUTE_STATUSES = ["OPEN", "AWAITING_SELLER", "AWAITING_BUYER", "UNDER_REVIEW"] as const;

/** Put a held escrow on hold (returns, disputes, chargebacks). */
export async function freezeSubOrderEscrow(tx: Prisma.TransactionClient, subOrderId: string, reason: string, now: Date): Promise<void> {
  await tx.escrow.updateMany({ where: { subOrderId, status: "HELD" }, data: { status: "FROZEN", frozenAt: now, frozenReason: reason.slice(0, 300) } });
}

/** Lift the hold once nothing is open on the sub-order any more. */
export async function unfreezeSubOrderIfClear(subOrderId: string): Promise<boolean> {
  const [openReturns, openDisputes] = await Promise.all([
    prisma.rmaRequest.count({ where: { orderItem: { subOrderId }, status: { in: [...OPEN_RETURN_STATUSES] } } }),
    prisma.dispute.count({ where: { subOrderId, status: { in: [...OPEN_DISPUTE_STATUSES] } } }),
  ]);
  if (openReturns > 0 || openDisputes > 0) return false;
  const updated = await prisma.escrow.updateMany({ where: { subOrderId, status: "FROZEN" }, data: { status: "HELD", frozenAt: null, frozenReason: null } });
  return updated.count > 0;
}
