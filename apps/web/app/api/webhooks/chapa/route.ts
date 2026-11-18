import { receiveChapaWebhook } from "@/lib/webhooks/chapa";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Chapa events: payments (charge.*), seller payouts (payout.*) and refunds. */
export async function POST(request: Request): Promise<Response> {
  return receiveChapaWebhook(request);
}
