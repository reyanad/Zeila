import { receiveStripeWebhook } from "@/lib/webhooks/stripe";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Events on sellers' connected accounts (onboarding status, capabilities). */
export async function POST(request: Request): Promise<Response> {
  return receiveStripeWebhook(request, "connect");
}
