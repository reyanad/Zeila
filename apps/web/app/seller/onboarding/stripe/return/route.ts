import { NextResponse } from "next/server";
import { prisma } from "@marketplace/database";
import { getCurrentUser } from "@/lib/auth/session";
import { appUrl } from "@/lib/env";
import { syncStripeAccount } from "@/lib/seller/stripe-account";
import { getStripe } from "@/lib/stripe";

export const dynamic = "force-dynamic";

/**
 * Stripe sends the seller here after the hosted onboarding flow. Returning
 * does not mean onboarding is complete, so the account is re-read from Stripe
 * (webhooks keep it current afterwards).
 */
export async function GET(): Promise<NextResponse> {
  const user = await getCurrentUser();
  if (!user) return NextResponse.redirect(appUrl("/login?callbackUrl=%2Fseller%2Fonboarding"));

  const stripe = getStripe();
  const store = await prisma.store.findUnique({ where: { sellerId: user.id }, select: { stripeAccountId: true } });
  let outcome = "returned";
  if (stripe && store?.stripeAccountId) {
    try {
      await syncStripeAccount(await stripe.accounts.retrieve(store.stripeAccountId));
    } catch (error) {
      console.error("[stripe] could not refresh account after onboarding", error);
      outcome = "sync-failed";
    }
  }
  return NextResponse.redirect(appUrl(`/seller/onboarding?stripe=${outcome}`));
}
