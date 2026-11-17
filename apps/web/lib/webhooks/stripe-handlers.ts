import "server-only";
import type Stripe from "stripe";
import { prisma } from "@marketplace/database";
import { closeChargeback, completeOrderPayment, recordChargeback } from "@marketplace/core";
import { recordAudit } from "@/lib/audit";
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

async function orderIdForCharge(chargeId: string): Promise<string | null> {
  const payment = await prisma.payment.findFirst({ where: { stripeChargeId: chargeId }, select: { orderId: true } });
  return payment?.orderId ?? null;
}

/** A chargeback becomes a card dispute per sub-order and freezes its escrow until the bank decides. */
async function onChargeDisputeCreated(event: Stripe.Event): Promise<void> {
  if (event.type !== "charge.dispute.created") return;
  const dispute = event.data.object;
  const chargeId = typeof dispute.charge === "string" ? dispute.charge : dispute.charge.id;
  const orderId = await orderIdForCharge(chargeId);
  if (!orderId) return;
  const dueBy = dispute.evidence_details?.due_by ? new Date(dispute.evidence_details.due_by * 1000) : null;
  const recorded = await recordChargeback(
    { orderId, stripeDisputeId: dispute.id, reason: dispute.reason, amount: dispute.amount, currency: dispute.currency.toUpperCase(), evidenceDueBy: dueBy },
    new Date(event.created * 1000),
  );
  await recordAudit({ actorId: null, action: "chargeback.opened", entity: "Order", entityId: orderId, data: { disputeId: dispute.id, reason: dispute.reason, amount: dispute.amount, subOrders: recorded } });
}

/** The bank's decision: won releases the hold; lost takes the money back out of escrow (or books a loss to recover). */
async function onChargeDisputeClosed(event: Stripe.Event): Promise<void> {
  if (event.type !== "charge.dispute.closed") return;
  const dispute = event.data.object;
  const chargeId = typeof dispute.charge === "string" ? dispute.charge : dispute.charge.id;
  const orderId = await orderIdForCharge(chargeId);
  if (!orderId) return;
  await closeChargeback({ stripeDisputeId: dispute.id, outcome: dispute.status, amount: dispute.amount }, new Date(event.created * 1000));
  await recordAudit({ actorId: null, action: `chargeback.${dispute.status}`, entity: "Order", entityId: orderId, data: { disputeId: dispute.id, amount: dispute.amount } });
}

/** Record refunds (including any made from the Stripe dashboard) against the payment. */
async function onChargeRefunded(event: Stripe.Event, stripe: Stripe): Promise<void> {
  if (event.type !== "charge.refunded") return;
  const charge = event.data.object;
  const intentId = typeof charge.payment_intent === "string" ? charge.payment_intent : charge.payment_intent?.id;
  if (!intentId) return;
  const payment = await prisma.payment.findUnique({ where: { stripePaymentIntentId: intentId }, select: { id: true, amount: true } });
  if (!payment) return;
  const refunds = await stripe.refunds.list({ charge: charge.id, limit: 100 });
  for (const refund of refunds.data) {
    if (refund.status === "failed" || refund.status === "canceled") continue;
    await prisma.refund.upsert({
      where: { stripeRefundId: refund.id },
      create: { paymentId: payment.id, stripeRefundId: refund.id, amount: refund.amount, reason: refund.reason ?? (refund.metadata?.reason ?? null) },
      update: { amount: refund.amount },
    });
  }
  await prisma.payment.update({
    where: { id: payment.id },
    data: { status: charge.amount_refunded >= payment.amount ? "REFUNDED" : "PARTIALLY_REFUNDED" },
  });
}

/** Sellers' bank payouts from their connected accounts, for the seller dashboard. */
async function onPayout(event: Stripe.Event): Promise<void> {
  if (!event.type.startsWith("payout.") || !event.account) return;
  const payout = event.data.object as Stripe.Payout;
  const store = await prisma.store.findUnique({ where: { stripeAccountId: event.account }, select: { id: true } });
  if (!store) return;
  const status = payout.status === "paid" ? "PAID" : payout.status === "failed" ? "FAILED" : payout.status === "canceled" ? "CANCELLED" : payout.status === "in_transit" ? "IN_TRANSIT" : "PENDING";
  const data = {
    amount: payout.amount,
    currency: payout.currency.toUpperCase(),
    status,
    arrivalAt: new Date(payout.arrival_date * 1000),
    failureReason: payout.failure_message ?? null,
  } as const;
  await prisma.payout.upsert({ where: { stripePayoutId: payout.id }, create: { ...data, storeId: store.id, stripePayoutId: payout.id }, update: data });
}

export const stripeEventHandlers: Readonly<Record<string, StripeEventHandler>> = {
  "charge.dispute.created": onChargeDisputeCreated,
  "charge.dispute.closed": onChargeDisputeClosed,
  "charge.refunded": onChargeRefunded,
  "payout.created": onPayout,
  "payout.updated": onPayout,
  "payout.paid": onPayout,
  "payout.failed": onPayout,
  "payout.canceled": onPayout,
  "payment_intent.succeeded": onPaymentIntentSucceeded,
  "payment_intent.payment_failed": onPaymentIntentFailed,
  "payment_intent.processing": onPaymentIntentProcessing,
  "account.updated": onAccountUpdated,
  "capability.updated": onCapabilityUpdated,
  "account.application.deauthorized": onApplicationDeauthorized,
};
