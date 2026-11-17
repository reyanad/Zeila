import "server-only";
import type Stripe from "stripe";
import { prisma, type Prisma, type WebhookEventStatus } from "@marketplace/database";
import { isUniqueViolation } from "@/lib/db-errors";
import { stripeWebhookSecret } from "@/lib/env";
import { getStripe } from "@/lib/stripe";
import { stripeEventHandlers } from "./stripe-handlers";

/**
 * Stripe webhook receiver with an idempotent inbox.
 *
 * 1. Verify the signature against the raw body.
 * 2. Insert the delivery into `WebhookEvent` once per (provider, event id).
 * 3. Run the handler. A redelivery of an event already PROCESSED or IGNORED is
 *    acknowledged without running anything; a FAILED one is retried.
 * 4. Answer 500 on handler failure so Stripe retries with backoff.
 */

export type StripeEndpoint = "platform" | "connect";

const PROVIDER: Readonly<Record<StripeEndpoint, string>> = {
  platform: "stripe",
  connect: "stripe-connect",
};

interface InboxRow {
  id: string;
  status: WebhookEventStatus;
}

async function recordDelivery(provider: string, event: Stripe.Event, rawBody: string): Promise<InboxRow> {
  try {
    return await prisma.webhookEvent.create({
      data: {
        provider,
        eventId: event.id,
        type: event.type,
        accountId: event.account ?? null,
        payload: JSON.parse(rawBody) as Prisma.InputJsonObject,
      },
      select: { id: true, status: true },
    });
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    return prisma.webhookEvent.findUniqueOrThrow({
      where: { provider_eventId: { provider, eventId: event.id } },
      select: { id: true, status: true },
    });
  }
}

export async function receiveStripeWebhook(request: Request, endpoint: StripeEndpoint): Promise<Response> {
  const stripe = getStripe();
  const secret = stripeWebhookSecret(endpoint);
  if (!stripe || !secret) {
    return Response.json({ error: "Stripe webhooks are not configured" }, { status: 503 });
  }

  const signature = request.headers.get("stripe-signature");
  if (!signature) return Response.json({ error: "Missing Stripe-Signature header" }, { status: 400 });

  const rawBody = await request.text();
  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, signature, secret);
  } catch {
    return Response.json({ error: "Invalid signature" }, { status: 400 });
  }

  const inbox = await recordDelivery(PROVIDER[endpoint], event, rawBody);
  if (inbox.status === "PROCESSED" || inbox.status === "IGNORED") {
    return Response.json({ received: true, duplicate: true });
  }

  const handler = stripeEventHandlers[event.type];
  if (!handler) {
    await prisma.webhookEvent.update({
      where: { id: inbox.id },
      data: { status: "IGNORED", processedAt: new Date(), attempts: { increment: 1 } },
    });
    return Response.json({ received: true, ignored: true });
  }

  try {
    await handler(event, stripe);
    await prisma.webhookEvent.update({
      where: { id: inbox.id },
      data: { status: "PROCESSED", processedAt: new Date(), attempts: { increment: 1 }, error: null },
    });
    return Response.json({ received: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[webhook] ${event.type} ${event.id} failed`, error);
    await prisma.webhookEvent.update({
      where: { id: inbox.id },
      data: { status: "FAILED", attempts: { increment: 1 }, error: message.slice(0, 2000) },
    });
    return Response.json({ error: "Event processing failed" }, { status: 500 });
  }
}
