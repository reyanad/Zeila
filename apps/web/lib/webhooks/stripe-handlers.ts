import "server-only";
import type Stripe from "stripe";
import { markAccountDisconnected, syncStripeAccount } from "@/lib/seller/stripe-account";

/**
 * Handlers for Stripe events, keyed by event type. Every handler must be
 * idempotent: Stripe may deliver an event more than once, and a FAILED
 * delivery is processed again on Stripe's retry.
 *
 * Event types without a handler are acknowledged and stored as IGNORED.
 */
export type StripeEventHandler = (event: Stripe.Event, stripe: Stripe) => Promise<void>;

async function onAccountUpdated(event: Stripe.Event): Promise<void> {
  if (event.type !== "account.updated") return;
  await syncStripeAccount(event.data.object);
}

async function onCapabilityUpdated(event: Stripe.Event, stripe: Stripe): Promise<void> {
  if (event.type !== "capability.updated") return;
  const capability = event.data.object;
  const accountId = typeof capability.account === "string" ? capability.account : capability.account.id;
  // The capability payload alone does not say whether payouts are enabled.
  await syncStripeAccount(await stripe.accounts.retrieve(accountId));
}

async function onApplicationDeauthorized(event: Stripe.Event): Promise<void> {
  if (event.type !== "account.application.deauthorized" || !event.account) return;
  await markAccountDisconnected(event.account);
}

export const stripeEventHandlers: Readonly<Record<string, StripeEventHandler>> = {
  "account.updated": onAccountUpdated,
  "capability.updated": onCapabilityUpdated,
  "account.application.deauthorized": onApplicationDeauthorized,
};
