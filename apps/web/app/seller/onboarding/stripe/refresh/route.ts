import { NextResponse } from "next/server";
import { prisma } from "@marketplace/database";
import { getCurrentUser } from "@/lib/auth/session";
import { appUrl } from "@/lib/env";
import { createOnboardingLink } from "@/lib/seller/stripe-account";
import { getStripe } from "@/lib/stripe";

export const dynamic = "force-dynamic";

/** Stripe sends the seller here when an onboarding link expired: issue a fresh one. */
export async function GET(): Promise<NextResponse> {
  const user = await getCurrentUser();
  if (!user) return NextResponse.redirect(appUrl("/login?callbackUrl=%2Fseller%2Fonboarding"));

  const stripe = getStripe();
  const store = await prisma.store.findUnique({ where: { sellerId: user.id }, select: { stripeAccountId: true } });
  if (!stripe || !store?.stripeAccountId) return NextResponse.redirect(appUrl("/seller/onboarding"));

  try {
    return NextResponse.redirect(await createOnboardingLink(stripe, store.stripeAccountId));
  } catch (error) {
    console.error("[stripe] could not create a fresh onboarding link", error);
    return NextResponse.redirect(appUrl("/seller/onboarding?stripe=link-failed"));
  }
}
