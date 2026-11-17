import "server-only";
import Stripe from "stripe";
import { getEnv, stripeSecretKey } from "@/lib/env";

let client: Stripe | null | undefined;

/** Stripe API client, or null when STRIPE_SECRET_KEY is not configured. */
export function getStripe(): Stripe | null {
  if (client !== undefined) return client;
  const key = stripeSecretKey();
  client = key ? new Stripe(key, { appInfo: { name: "Marketplace" }, maxNetworkRetries: 2 }) : null;
  return client;
}

/** Country of the platform's own Stripe account (ISO-3166 alpha-2). */
export function platformCountry(): string {
  return getEnv().STRIPE_PLATFORM_COUNTRY;
}

/**
 * Message safe to show a signed-in user for a failed Stripe call. Stripe's
 * own messages explain configuration problems (for example an unsupported
 * seller country) without leaking secrets; anything else stays generic.
 */
export function stripeErrorMessage(error: unknown): string {
  if (
    typeof error === "object" &&
    error !== null &&
    "type" in error &&
    typeof error.type === "string" &&
    error.type.startsWith("Stripe") &&
    "message" in error &&
    typeof error.message === "string"
  ) {
    return `Stripe could not complete the request: ${error.message}`;
  }
  return "Stripe could not be reached. Try again in a few minutes.";
}
