import { prisma, type UserRole } from "@marketplace/database";
import { CheckoutError } from "./errors";
import { accounts, postEntry } from "./ledger";
import { notify } from "./notifications";

/**
 * Staff operations behind the admin command center. Every function takes the
 * acting staff member's id; callers check permissions and write the audit log.
 */

// ---------------------------------------------------------------------------
// Identity checks
// ---------------------------------------------------------------------------

export async function decideKyc(staffId: string, submissionId: string, approve: boolean, reason: string, now: Date): Promise<{ userId: string; storeId: string | null }> {
  const submission = await prisma.kycSubmission.findUnique({ where: { id: submissionId }, select: { id: true, status: true, userId: true, user: { select: { store: { select: { id: true } } } } } });
  if (!submission) throw new CheckoutError("That submission does not exist.");
  if (submission.status !== "PENDING") throw new CheckoutError("This submission was already decided.");
  if (submission.userId === staffId) throw new CheckoutError("You cannot review your own identity check.");
  if (!approve && reason.trim().length < 10) throw new CheckoutError("Tell the seller what to fix (at least 10 characters).");
  const updated = await prisma.kycSubmission.updateMany({
    where: { id: submission.id, status: "PENDING" },
    data: { status: approve ? "APPROVED" : "REJECTED", reviewedById: staffId, reviewedAt: now, rejectionReason: approve ? null : reason.trim().slice(0, 1_000) },
  });
  if (updated.count === 0) throw new CheckoutError("This submission was already decided.");
  await notify({
    userId: submission.userId,
    type: "KYC_UPDATED",
    title: approve ? "Your identity is verified" : "We could not verify your identity",
    body: approve ? "Your store goes live as soon as payouts are connected." : reason.trim().slice(0, 300),
    href: "/seller/onboarding",
  });
  return { userId: submission.userId, storeId: submission.user.store?.id ?? null };
}

// ---------------------------------------------------------------------------
// Listings
// ---------------------------------------------------------------------------

export async function moderateListing(staffId: string, listingId: string, decision: "approve" | "reject", note: string, now: Date): Promise<{ storeSellerId: string }> {
  const listing = await prisma.listing.findUnique({ where: { id: listingId }, select: { id: true, status: true, title: true, publishedAt: true, store: { select: { sellerId: true } } } });
  if (!listing) throw new CheckoutError("That listing does not exist.");
  if (decision === "reject" && note.trim().length < 10) throw new CheckoutError("Explain what breaks the rules (at least 10 characters).");
  if (decision === "approve" && listing.status !== "PENDING_REVIEW") throw new CheckoutError("Only listings waiting for review can be approved.");
  if (decision === "reject" && !["PENDING_REVIEW", "ACTIVE", "PAUSED"].includes(listing.status)) throw new CheckoutError("This listing is not live or waiting for review.");
  await prisma.listing.update({
    where: { id: listing.id },
    data:
      decision === "approve"
        ? { status: "ACTIVE", publishedAt: listing.publishedAt ?? now, moderatedById: staffId, moderationNote: note.trim() || null }
        : { status: "REJECTED", moderatedById: staffId, moderationNote: note.trim().slice(0, 1_000) },
  });
  await notify({
    userId: listing.store.sellerId,
    type: "SYSTEM",
    title: decision === "approve" ? `“${listing.title}” is live` : `“${listing.title}” was taken down`,
    body: decision === "approve" ? null : note.trim().slice(0, 300),
    href: `/seller/studio/listings/${listing.id}`,
  });
  return { storeSellerId: listing.store.sellerId };
}

// ---------------------------------------------------------------------------
// Users, stores and roles
// ---------------------------------------------------------------------------

export async function suspendUser(staffId: string, userId: string, reason: string): Promise<{ storeId: string | null }> {
  if (userId === staffId) throw new CheckoutError("You cannot suspend yourself.");
  if (reason.trim().length < 10) throw new CheckoutError("Record why (at least 10 characters).");
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { role: true, store: { select: { id: true } } } });
  if (!user) throw new CheckoutError("That user does not exist.");
  if (user.role === "SUPER_ADMIN") throw new CheckoutError("Super admins cannot be suspended here.");
  await prisma.$transaction(async (tx) => {
    // Bumping the session version signs the user out everywhere.
    await tx.user.update({ where: { id: userId }, data: { isSuspended: true, suspendedReason: reason.trim().slice(0, 500), sessionVersion: { increment: 1 } } });
    if (user.store) await tx.store.update({ where: { id: user.store.id }, data: { status: "SUSPENDED" } });
  });
  return { storeId: user.store?.id ?? null };
}

/** Lift a suspension; the store returns to DRAFT so its status is recomputed from KYC and payouts. */
export async function reinstateUser(userId: string): Promise<{ storeId: string | null }> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { store: { select: { id: true, status: true } } } });
  if (!user) throw new CheckoutError("That user does not exist.");
  await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id: userId }, data: { isSuspended: false, suspendedReason: null } });
    if (user.store?.status === "SUSPENDED") await tx.store.update({ where: { id: user.store.id }, data: { status: "DRAFT" } });
  });
  return { storeId: user.store?.id ?? null };
}

export async function setUserRole(actorId: string, userId: string, role: UserRole): Promise<void> {
  if (actorId === userId) throw new CheckoutError("You cannot change your own role.");
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { role: true, store: { select: { id: true } } } });
  if (!user) throw new CheckoutError("That user does not exist.");
  if (role === "SELLER" && !user.store) throw new CheckoutError("Sellers get this role by opening a store.");
  if (user.role === "SELLER" && role === "BUYER" && user.store) throw new CheckoutError("Close or suspend the store instead of removing the seller role.");
  await prisma.user.update({ where: { id: userId }, data: { role, sessionVersion: { increment: 1 } } });
}

// ---------------------------------------------------------------------------
// Fraud
// ---------------------------------------------------------------------------

export async function setFraudFlagStatus(flagId: string, status: "REVIEWING" | "CONFIRMED" | "DISMISSED", now: Date): Promise<void> {
  const updated = await prisma.fraudFlag.updateMany({
    where: { id: flagId, status: { in: ["OPEN", "REVIEWING"] } },
    data: { status, resolvedAt: status === "REVIEWING" ? null : now },
  });
  if (updated.count === 0) throw new CheckoutError("That flag is already closed.");
}

export interface CircumventionSignal {
  userId: string;
  name: string | null;
  email: string;
  flagged: number;
}

/** People who repeatedly tried to move contact or payment off the platform. */
export async function circumventionSignals(since: Date, minimum = 3): Promise<CircumventionSignal[]> {
  const rows = await prisma.message.groupBy({
    by: ["senderId"],
    where: { flaggedCircumvention: true, createdAt: { gte: since } },
    _count: { _all: true },
    having: { senderId: { _count: { gte: minimum } } },
    orderBy: { _count: { senderId: "desc" } },
    take: 50,
  });
  const users = await prisma.user.findMany({ where: { id: { in: rows.map((row) => row.senderId) } }, select: { id: true, name: true, email: true } });
  const byId = new Map(users.map((user) => [user.id, user]));
  return rows.flatMap((row) => {
    const user = byId.get(row.senderId);
    return user ? [{ userId: user.id, name: user.name, email: user.email, flagged: row._count._all }] : [];
  });
}

// ---------------------------------------------------------------------------
// Money: affiliate payouts and reconciliation
// ---------------------------------------------------------------------------

/** Record that approved commissions were paid out to an affiliate (bank transfer made outside the platform). */
export async function payAffiliate(staffId: string, affiliateId: string, currency: string, reference: string, now: Date): Promise<number> {
  if (reference.trim().length < 4) throw new CheckoutError("Enter the payment reference.");
  return prisma.$transaction(async (tx) => {
    const due = await tx.referral.findMany({ where: { affiliateId, currency, status: "APPROVED" }, select: { id: true, commission: true } });
    const total = due.reduce((sum, row) => sum + row.commission, 0);
    if (total <= 0) throw new CheckoutError("Nothing is due to this affiliate in that currency.");
    await tx.referral.updateMany({ where: { id: { in: due.map((row) => row.id) }, status: "APPROVED" }, data: { status: "PAID", paidAt: now } });
    await postEntry(tx, {
      idempotencyKey: `affiliate-payout:${affiliateId}:${currency}:${due.map((row) => row.id).sort().join(",")}`,
      description: `Affiliate payout ${reference.trim().slice(0, 80)}`,
      occurredAt: now,
      metadata: { affiliateId, staffId, reference: reference.trim().slice(0, 120), referrals: due.length },
      lines: [
        { account: accounts.affiliatePayable(affiliateId, currency), direction: "DEBIT", amount: total },
        { account: accounts.cash(currency), direction: "CREDIT", amount: total },
      ],
    });
    return total;
  });
}

export interface ReconciliationRow {
  currency: string;
  ledgerEscrow: number;
  recordsEscrow: number;
  ledgerPayable: number;
  recordsPayable: number;
}

/**
 * Cross-check the ledger against the operational records: money the ledger
 * says is in escrow must equal held escrow rows (net of refunds), and the
 * payable balance must equal released escrows not yet transferred.
 */
export async function escrowReconciliation(): Promise<ReconciliationRow[]> {
  const [ledger, held, released] = await Promise.all([
    prisma.$queryRaw<Array<{ currency: string; kind: string; balance: bigint | null }>>`
      SELECT a."currency" AS currency,
             CASE WHEN a."code" LIKE 'store:%:escrow:%' THEN 'escrow' ELSE 'payable' END AS kind,
             SUM(CASE WHEN l."direction" = 'CREDIT' THEN l."amount" ELSE -l."amount" END) AS balance
      FROM "LedgerAccount" a JOIN "LedgerLine" l ON l."accountId" = a."id"
      WHERE a."code" LIKE 'store:%:escrow:%' OR a."code" LIKE 'store:%:payable:%'
      GROUP BY 1, 2`,
    prisma.$queryRaw<Array<{ currency: string; total: bigint | null }>>`
      SELECT s."currency" AS currency, SUM(e."amount" - e."refunded") AS total
      FROM "Escrow" e JOIN "SubOrder" s ON s."id" = e."subOrderId"
      WHERE e."status" IN ('HELD', 'FROZEN', 'PARTIALLY_RELEASED')
      GROUP BY 1`,
    prisma.$queryRaw<Array<{ currency: string; total: bigint | null }>>`
      SELECT s."currency" AS currency, SUM(e."released") AS total
      FROM "Escrow" e JOIN "SubOrder" s ON s."id" = e."subOrderId"
      WHERE e."status" = 'RELEASED' AND e."payoutId" IS NULL
      GROUP BY 1`,
  ]);
  const currencies = new Set([...ledger.map((row) => row.currency), ...held.map((row) => row.currency), ...released.map((row) => row.currency)]);
  return [...currencies].sort().map((currency) => ({
    currency,
    ledgerEscrow: Number(ledger.find((row) => row.currency === currency && row.kind === "escrow")?.balance ?? 0),
    recordsEscrow: Number(held.find((row) => row.currency === currency)?.total ?? 0),
    ledgerPayable: Number(ledger.find((row) => row.currency === currency && row.kind === "payable")?.balance ?? 0),
    recordsPayable: Number(released.find((row) => row.currency === currency)?.total ?? 0),
  }));
}
