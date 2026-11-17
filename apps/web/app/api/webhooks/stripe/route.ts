import { receiveStripeWebhook } from "@/lib/webhooks/stripe";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Events on the platform's own Stripe account (payments, refunds, transfers). */
export async function POST(request: Request): Promise<Response> {
  return receiveStripeWebhook(request, "platform");
}
