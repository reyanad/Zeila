import "server-only";
import type Stripe from "stripe";
import { prisma } from "@marketplace/database";
import { completeOrderPayment } from "@marketplace/core";
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

/**
 * Payment confirmed. The order is completed atomically; a payment that cannot
 * be applied (the order expired or was cancelled meanwhile, or the amount does
 * not match) is refunded in full so the buyer is never charged for nothing.
 */
async function onPaymentIntentSucceeded(event: Stripe.Event, stripe: Stripe): Promise<void> {
  if (event.type !== "payment_intent.succeeded") return;
  const intent = event.data.object;
  const orderId = intent.metadata.orderId;
  if (!orderId) return;
  const chargeId = typeof intent.latest_charge === "string" ? intent.latest_charge : (intent.latest_charge?.id ?? null);
  const outcome = await completeOrderPayment({
    orderId,
    paymentIntentId: intent.id,
    chargeId,
    amount: intent.amount_received,
    currency: intent.currency.toUpperCase(),
    paidAt: new Date(event.created * 1000),
  });
  if (outcome === "not-pending" || outcome === "amount-mismatch" || outcome === "missing") {
    console.error(`[payments] ${intent.id} for order ${orderId} could not be applied (${outcome}); refunding`);
    const refund = await stripe.refunds.create({ payment_intent: intent.id, reason: "requested_by_customer" }, { idempotencyKey: `refund-unapplied-${intent.id}` });
    const payment = await prisma.payment.findUnique({ where: { stripePaymentIntentId: intent.id }, select: { id: true } });
    if (payment) {
      await prisma.payment.update({ where: { id: payment.id }, data: { status: "REFUNDED", stripeChargeId: chargeId, failureReason: `Refunded: order ${outcome}` } });
      await prisma.refund.upsert({
        where: { stripeRefundId: refund.id },
        create: { paymentId: payment.id, stripeRefundId: refund.id, amount: refund.amount, reason: `order ${outcome}` },
        update: {},
      });
    }
  }
}

async function onPaymentIntentFailed(event: Stripe.Event): Promise<void> {
  if (event.type !== "payment_intent.payment_failed") return;
  const intent = event.data.object;
  // The order stays open so the buyer can retry until it expires.
  await prisma.payment.updateMany({
    where: { stripePaymentIntentId: intent.id, status: { notIn: ["SUCCEEDED", "REFUNDED"] } },
    data: { status: "FAILED", failureReason: intent.last_payment_error?.message?.slice(0, 500) ?? "Payment failed" },
  });
}

async function onPaymentIntentProcessing(event: Stripe.Event): Promise<void> {
  if (event.type !== "payment_intent.processing") return;
  await prisma.payment.updateMany({
    where: { stripePaymentIntentId: event.data.object.id, status: { in: ["REQUIRES_ACTION", "FAILED"] } },
    data: { status: "PROCESSING" },
  });
}

export const stripeEventHandlers: Readonly<Record<string, StripeEventHandler>> = {
  "payment_intent.succeeded": onPaymentIntentSucceeded,
  "payment_intent.payment_failed": onPaymentIntentFailed,
  "payment_intent.processing": onPaymentIntentProcessing,
  "account.updated": onAccountUpdated,
  "capability.updated": onCapabilityUpdated,
  "account.application.deauthorized": onApplicationDeauthorized,
};
