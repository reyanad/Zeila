import "server-only";
import { prisma, type StoreStatus } from "@marketplace/database";

/**
 * Recompute a store's status from its prerequisites:
 *
 *   ACTIVE          identity verified (KYC approved) and payouts ready on Stripe
 *   PENDING_REVIEW  identity documents submitted and awaiting staff review
 *   DRAFT           anything else (setup incomplete, KYC rejected, payouts off)
 *
 * SUSPENDED and CLOSED are staff decisions and are never changed here.
 * Call after any change to KYC or to the store's Stripe account.
 */
export async function syncStoreStatus(storeId: string): Promise<StoreStatus | null> {
  const store = await prisma.store.findUnique({
    where: { id: storeId },
    select: { id: true, status: true, sellerId: true, payoutsEnabled: true, stripeOnboarding: true },
  });
  if (!store) return null;
  if (store.status === "SUSPENDED" || store.status === "CLOSED") return store.status;

  const kyc = await prisma.kycSubmission.findFirst({
    where: { userId: store.sellerId },
    orderBy: { createdAt: "desc" },
    select: { status: true },
  });
  const payoutsReady = store.payoutsEnabled && store.stripeOnboarding === "COMPLETE";

  let next: StoreStatus = "DRAFT";
  if (kyc?.status === "APPROVED" && payoutsReady) next = "ACTIVE";
  else if (kyc?.status === "PENDING") next = "PENDING_REVIEW";

  if (next !== store.status) {
    await prisma.store.update({ where: { id: store.id }, data: { status: next } });
  }
  return next;
}
