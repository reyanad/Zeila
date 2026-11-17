import { randomInt } from "node:crypto";
import { prisma, type Prisma } from "@marketplace/database";
import { applyBps } from "@marketplace/shared-types";
import { CheckoutError } from "./errors";
import { accounts, postEntry } from "./ledger";

/**
 * Affiliate program. Anyone can share a referral link (`?ref=CODE`); orders
 * placed within the attribution window earn the affiliate a share of the
 * platform's commission (never the seller's money), approved once the order
 * is settled and every escrow released, net of refunds.
 */

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const AFFILIATE_COOKIE = "aff_ref";
export const AFFILIATE_WINDOW_DAYS = 30;

function newCode(): string {
  let code = "";
  for (let index = 0; index < 8; index += 1) code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return code;
}

export async function joinAffiliateProgram(userId: string): Promise<string> {
  const existing = await prisma.affiliate.findUnique({ where: { userId }, select: { code: true, status: true } });
  if (existing) {
    if (existing.status !== "ACTIVE") throw new CheckoutError("Your affiliate account is not active. Contact support.");
    return existing.code;
  }
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      const created = await prisma.affiliate.create({ data: { userId, code: newCode() }, select: { code: true } });
      return created.code;
    } catch (error) {
      const collision = typeof error === "object" && error !== null && "code" in error && error.code === "P2002";
      if (!collision) throw error;
    }
  }
  throw new CheckoutError("Could not create your referral code. Try again.");
}

/** Count a click on a referral link; returns the affiliate code to remember, or null. */
export async function recordAffiliateClick(code: string): Promise<string | null> {
  const normalized = code.trim().toUpperCase();
  if (!/^[A-Z2-9]{8}$/.test(normalized)) return null;
  const updated = await prisma.affiliate.updateMany({ where: { code: normalized, status: "ACTIVE" }, data: { clicks: { increment: 1 } } });
  return updated.count > 0 ? normalized : null;
}

/** Tag a just-placed order with the referring affiliate (self-referrals are ignored). */
export async function attributeOrder(orderId: string, buyerId: string, code: string | null): Promise<boolean> {
  if (!code) return false;
  const affiliate = await prisma.affiliate.findUnique({ where: { code: code.toUpperCase() }, select: { id: true, userId: true, status: true } });
  if (!affiliate || affiliate.status !== "ACTIVE" || affiliate.userId === buyerId) return false;
  const order = await prisma.order.findFirst({ where: { id: orderId, buyerId, status: "PENDING_PAYMENT" }, select: { metadata: true } });
  if (!order) return false;
  const metadata = typeof order.metadata === "object" && order.metadata !== null && !Array.isArray(order.metadata) ? (order.metadata as Prisma.JsonObject) : {};
  await prisma.order.update({ where: { id: orderId }, data: { metadata: { ...metadata, affiliate: { affiliateId: affiliate.id } } } });
  return true;
}

function affiliateIdOf(metadata: Prisma.JsonValue): string | null {
  if (typeof metadata !== "object" || metadata === null || Array.isArray(metadata)) return null;
  const affiliate = (metadata as Record<string, unknown>).affiliate;
  const id = typeof affiliate === "object" && affiliate !== null ? (affiliate as Record<string, unknown>).affiliateId : null;
  return typeof id === "string" ? id : null;
}

/** On payment: open a pending referral for an attributed order. */
export async function recordReferralForPaidOrder(orderId: string): Promise<void> {
  const order = await prisma.order.findUnique({ where: { id: orderId }, select: { id: true, buyerId: true, currency: true, metadata: true } });
  const affiliateId = order ? affiliateIdOf(order.metadata) : null;
  if (!order || !affiliateId) return;
  const existing = await prisma.referral.findFirst({ where: { orderId: order.id }, select: { id: true } });
  if (existing) return;
  await prisma.referral.create({ data: { affiliateId, orderId: order.id, referredUserId: order.buyerId, currency: order.currency, status: "PENDING" } });
}

/** Commission on what the platform actually kept: each sub-order's fee scaled by the share not refunded. */
export function referralCommission(subOrders: ReadonlyArray<{ platformFee: number; grandTotal: number; refundedTotal: number; status: string }>, commissionBps: number): number {
  const kept = subOrders
    .filter((subOrder) => subOrder.status !== "CANCELLED" && subOrder.grandTotal > 0)
    .reduce((sum, subOrder) => sum + Math.floor((subOrder.platformFee * Math.max(0, subOrder.grandTotal - subOrder.refundedTotal)) / subOrder.grandTotal), 0);
  return applyBps(kept, commissionBps);
}

/** Worker: approve (or reverse) referrals whose orders are fully settled. */
export async function settleReferrals(now: Date, limit = 200): Promise<{ approved: number; reversed: number }> {
  const pending = await prisma.referral.findMany({
    where: { status: "PENDING", orderId: { not: null } },
    take: limit,
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      affiliateId: true,
      currency: true,
      affiliate: { select: { commissionBps: true } },
      order: { select: { status: true, subOrders: { select: { platformFee: true, grandTotal: true, refundedTotal: true, status: true } } } },
    },
  });
  let approved = 0;
  let reversed = 0;
  for (const referral of pending) {
    const order = referral.order;
    if (!order) continue;
    const settled = order.subOrders.length > 0 && order.subOrders.every((subOrder) => ["COMPLETED", "REFUNDED", "CANCELLED"].includes(subOrder.status));
    if (order.status === "CANCELLED") {
      await prisma.referral.update({ where: { id: referral.id }, data: { status: "REVERSED" } });
      reversed += 1;
      continue;
    }
    if (!settled) continue;
    const commission = referralCommission(order.subOrders, referral.affiliate.commissionBps);
    if (commission <= 0) {
      await prisma.referral.update({ where: { id: referral.id }, data: { status: "REVERSED", commission: 0 } });
      reversed += 1;
      continue;
    }
    await prisma.$transaction(async (tx) => {
      const claimed = await tx.referral.updateMany({ where: { id: referral.id, status: "PENDING" }, data: { status: "APPROVED", commission, approvedAt: now } });
      if (claimed.count === 0) return;
      await postEntry(tx, {
        idempotencyKey: `affiliate-commission:${referral.id}`,
        description: `Affiliate commission for referral ${referral.id}`,
        occurredAt: now,
        metadata: { referralId: referral.id, affiliateId: referral.affiliateId },
        lines: [
          { account: accounts.affiliateExpense(referral.currency), direction: "DEBIT", amount: commission },
          { account: accounts.affiliatePayable(referral.affiliateId, referral.currency), direction: "CREDIT", amount: commission },
        ],
      });
    });
    approved += 1;
  }
  return { approved, reversed };
}
