import "server-only";
import type Stripe from "stripe";
import { prisma, type StripeOnboardingStatus } from "@marketplace/database";
import { appUrl } from "@/lib/env";
import { platformCountry } from "@/lib/stripe";
import { syncStoreStatus } from "./status";

/**
 * Stripe Connect Express accounts for sellers.
 *
 * Funds flow is "separate charges and transfers": buyers pay the platform,
 * the money is held (escrow) and transferred to the seller's connected account
 * when the order is released. Connected accounts therefore only need the
 * `transfers` capability. Sellers outside the platform's country are created
 * under the "recipient" service agreement (Stripe cross-border payouts).
 */

interface StoreForAccount {
  id: string;
  sellerId: string;
  country: string;
  stripeAccountId: string | null;
}

export async function ensureConnectedAccount(stripe: Stripe, store: StoreForAccount, email: string): Promise<string> {
  if (store.stripeAccountId) return store.stripeAccountId;

  const crossBorder = store.country !== platformCountry();
  const account = await stripe.accounts.create(
    {
      type: "express",
      country: store.country,
      email,
      capabilities: { transfers: { requested: true } },
      ...(crossBorder ? { tos_acceptance: { service_agreement: "recipient" } } : {}),
      metadata: { storeId: store.id, sellerId: store.sellerId },
    },
    // Retries and double-clicks within 24h return the same account.
    { idempotencyKey: `connect-account-${store.id}` },
  );

  const claimed = await prisma.store.updateMany({
    where: { id: store.id, stripeAccountId: null },
    data: { stripeAccountId: account.id, stripeOnboarding: "IN_PROGRESS" },
  });
  if (claimed.count === 1) return account.id;

  const current = await prisma.store.findUnique({ where: { id: store.id }, select: { stripeAccountId: true } });
  if (current?.stripeAccountId) return current.stripeAccountId;
  throw new Error(`Store ${store.id} has no Stripe account after creating ${account.id}`);
}

export async function createOnboardingLink(stripe: Stripe, accountId: string): Promise<string> {
  const link = await stripe.accountLinks.create({
    account: accountId,
    type: "account_onboarding",
    refresh_url: appUrl("/seller/onboarding/stripe/refresh"),
    return_url: appUrl("/seller/onboarding/stripe/return"),
  });
  return link.url;
}

const RESTRICTING_REASONS: ReadonlySet<string> = new Set(["listed", "under_review", "platform_paused", "other"]);

export function onboardingStatusOf(account: Stripe.Account): StripeOnboardingStatus {
  const disabledReason = account.requirements?.disabled_reason ?? null;
  if (disabledReason && (disabledReason.startsWith("rejected") || RESTRICTING_REASONS.has(disabledReason))) {
    return "RESTRICTED";
  }
  if (account.details_submitted && account.payouts_enabled && account.capabilities?.transfers === "active") {
    return "COMPLETE";
  }
  return "IN_PROGRESS";
}

/**
 * Copy a connected account's state onto its store and recompute the store's
 * status. Returns false when no store uses this account.
 */
export async function syncStripeAccount(account: Stripe.Account): Promise<boolean> {
  const store = await prisma.store.findUnique({ where: { stripeAccountId: account.id }, select: { id: true } });
  if (!store) return false;

  const transfersActive = account.capabilities?.transfers === "active";
  await prisma.store.update({
    where: { id: store.id },
    data: {
      chargesEnabled: account.charges_enabled === true,
      payoutsEnabled: account.payouts_enabled === true && transfersActive,
      stripeOnboarding: onboardingStatusOf(account),
    },
  });
  await syncStoreStatus(store.id);
  return true;
}

/** The seller disconnected the platform: the account can no longer receive transfers. */
export async function markAccountDisconnected(accountId: string): Promise<boolean> {
  const store = await prisma.store.findUnique({ where: { stripeAccountId: accountId }, select: { id: true } });
  if (!store) return false;
  await prisma.store.update({
    where: { id: store.id },
    data: { chargesEnabled: false, payoutsEnabled: false, stripeOnboarding: "RESTRICTED" },
  });
  await syncStoreStatus(store.id);
  return true;
}
