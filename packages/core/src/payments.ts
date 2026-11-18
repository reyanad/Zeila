import { prisma } from "@marketplace/database";
import { APP_NAME } from "@marketplace/shared-types";
import { CheckoutError } from "./errors";
import { GATEWAY_CURRENCIES, type PaymentGateway } from "./gateway";
import { cancelUnpaidOrder, completeOrderPayment, type PaymentOutcome } from "./orders";
import { requestProviderRefund } from "./refunds";

/**
 * Buyers pay on Chapa's hosted checkout. Every attempt gets its own tx_ref
 * (`<order number>-<n>`) and Payment row; the order is only marked paid after
 * Chapa's verify endpoint confirms the charge, whichever arrives first: the
 * buyer's return, Chapa's callback, the webhook or the expiry sweep.
 *
 * Funds flow: the platform collects the whole payment, holds each store's
 * share in escrow, and pays it out by Chapa transfer when the order is
 * released (see escrow.ts).
 */

/** A hosted checkout link is reused for this long before a fresh attempt is started. */
const CHECKOUT_REUSE_MS = 20 * 60_000;

/** Chapa accepts Ethiopian mobile numbers as 09xxxxxxxx or 07xxxxxxxx. */
export function chapaPhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const digits = raw.replace(/[^\d+]/g, "");
  const local = digits.startsWith("+251") ? `0${digits.slice(4)}` : digits.startsWith("251") ? `0${digits.slice(3)}` : digits;
  return /^0[79]\d{8}$/.test(local) ? local : null;
}

function splitName(name: string | null): { firstName: string | null; lastName: string | null } {
  const parts = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { firstName: null, lastName: null };
  return { firstName: parts[0] ?? null, lastName: parts.length > 1 ? parts.slice(1).join(" ") : null };
}

function addressPhone(snapshot: unknown): string | null {
  if (typeof snapshot !== "object" || snapshot === null) return null;
  const phone = (snapshot as Record<string, unknown>).phone;
  return typeof phone === "string" ? phone : null;
}

export interface CheckoutUrls {
  /** Where Chapa sends the buyer afterwards. */
  returnUrl: string;
  /** Chapa's server-to-server notification for this transaction. */
  callbackUrl: string;
}

/** Start (or resume) payment for an order and return Chapa's checkout link. */
export async function startCheckout(gateway: PaymentGateway, orderId: string, urls: CheckoutUrls, now: Date): Promise<{ checkoutUrl: string }> {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: {
      id: true,
      orderNumber: true,
      grandTotal: true,
      currency: true,
      status: true,
      shippingAddress: true,
      buyer: { select: { email: true, name: true, phone: true } },
      payments: { orderBy: { createdAt: "desc" }, select: { id: true, providerRef: true, status: true, checkoutUrl: true, createdAt: true } },
    },
  });
  if (!order) throw new CheckoutError("That order does not exist.");
  if (order.status !== "PENDING_PAYMENT") throw new CheckoutError("This order is no longer waiting for payment.");
  if (!GATEWAY_CURRENCIES.includes(order.currency)) throw new CheckoutError(`Payments are available in ${GATEWAY_CURRENCIES.join(" and ")} only.`);

  // A recent link the buyer may still be using: check it first so nobody pays twice.
  const latest = order.payments[0];
  if (latest && latest.status === "REQUIRES_ACTION" && latest.checkoutUrl && now.getTime() - latest.createdAt.getTime() < CHECKOUT_REUSE_MS) {
    const outcome = await confirmPayment(gateway, latest.providerRef, now);
    if (outcome === "paid") throw new CheckoutError("This order is already paid.");
    if (outcome === "unpaid") return { checkoutUrl: latest.checkoutUrl };
  }

  const txRef = `${order.orderNumber}-${order.payments.length + 1}`;
  const payment = await prisma.payment.create({
    data: { orderId: order.id, provider: "chapa", providerRef: txRef, amount: order.grandTotal, currency: order.currency, status: "REQUIRES_ACTION" },
    select: { id: true },
  });
  const { firstName, lastName } = splitName(order.buyer.name);
  try {
    const { checkoutUrl } = await gateway.initializeCheckout({
      txRef,
      amount: order.grandTotal,
      currency: order.currency,
      email: order.buyer.email,
      firstName,
      lastName,
      phone: chapaPhone(order.buyer.phone) ?? chapaPhone(addressPhone(order.shippingAddress)),
      callbackUrl: urls.callbackUrl,
      returnUrl: urls.returnUrl,
      title: APP_NAME,
      description: `Order ${order.orderNumber}`,
    });
    await prisma.payment.update({ where: { id: payment.id }, data: { checkoutUrl } });
    return { checkoutUrl };
  } catch (error) {
    await prisma.payment.update({ where: { id: payment.id }, data: { status: "FAILED", failureReason: (error instanceof Error ? error.message : String(error)).slice(0, 500) } });
    throw error;
  }
}

export type ConfirmOutcome = "paid" | "pending" | "failed" | "unpaid" | "refunded" | "missing";

/**
 * Ask Chapa for the truth about one payment attempt and apply it. Safe to call
 * any number of times. A charge that cannot be applied (the order expired or
 * was cancelled meanwhile, another attempt already paid it, or the amount does
 * not match) is refunded in full, so a buyer is never charged for nothing.
 */
export async function confirmPayment(gateway: PaymentGateway, txRef: string, now: Date): Promise<ConfirmOutcome> {
  const payment = await prisma.payment.findUnique({ where: { providerRef: txRef }, select: { id: true, orderId: true, status: true, providerRef: true, amount: true, currency: true } });
  if (!payment) return "missing";
  if (payment.status === "SUCCEEDED" || payment.status === "PARTIALLY_REFUNDED") return "paid";
  if (payment.status === "REFUNDED") return "refunded";

  const charge = await gateway.verifyTransaction(txRef);
  if (charge.status === "not_found") return "unpaid";
  if (charge.status === "pending") {
    await prisma.payment.updateMany({ where: { id: payment.id, status: { in: ["REQUIRES_ACTION", "FAILED"] } }, data: { status: "PROCESSING" } });
    return "pending";
  }
  if (charge.status === "failed") {
    await prisma.payment.updateMany({ where: { id: payment.id, status: { in: ["REQUIRES_ACTION", "PROCESSING"] } }, data: { status: "FAILED", failureReason: "Chapa reported the payment failed" } });
    return "failed";
  }

  await prisma.payment.update({ where: { id: payment.id }, data: { method: charge.method, providerReference: charge.reference } });
  let outcome: PaymentOutcome = "amount-mismatch";
  if (charge.currency === payment.currency && charge.amount === payment.amount) {
    outcome = await completeOrderPayment({
      orderId: payment.orderId,
      providerRef: txRef,
      providerReference: charge.reference,
      amount: charge.amount,
      currency: charge.currency,
      paidAt: charge.paidAt ?? now,
    });
  }
  if (outcome === "completed") return "paid";
  if (outcome === "already-paid") {
    const current = await prisma.payment.findUnique({ where: { id: payment.id }, select: { status: true } });
    if (current?.status === "SUCCEEDED") return "paid";
  }

  // Money arrived that this order cannot use: send it back.
  console.error(`[payments] ${txRef} for order ${payment.orderId} could not be applied (${outcome}); refunding`);
  await prisma.payment.update({ where: { id: payment.id }, data: { status: "SUCCEEDED", failureReason: `Refunding: order ${outcome}` } });
  await requestProviderRefund(gateway, payment, {
    idempotencyKey: `unapplied:${txRef}`,
    amount: charge.amount,
    currency: charge.currency,
    reason: `Payment could not be applied (${outcome})`,
  });
  await prisma.payment.update({ where: { id: payment.id }, data: { status: "REFUNDED" } });
  return "refunded";
}

/**
 * Cancel an unpaid order, unless Chapa has (or may still be completing) a
 * payment for it: a paid attempt is applied instead, a pending one leaves the
 * order for the webhook. Returns whether the order was cancelled.
 */
export async function abandonOrder(gateway: PaymentGateway | null, orderId: string, now: Date = new Date()): Promise<boolean> {
  const payments = await prisma.payment.findMany({ where: { orderId, status: { notIn: ["CANCELLED", "FAILED", "SUCCEEDED", "REFUNDED"] } }, select: { providerRef: true } });
  if (payments.length > 0 && !gateway) {
    // Without Chapa credentials the payment state cannot be checked; leave the order alone.
    return false;
  }
  for (const payment of payments) {
    const outcome = await confirmPayment(gateway as PaymentGateway, payment.providerRef, now);
    if (outcome === "paid" || outcome === "pending") return false;
  }
  return cancelUnpaidOrder(orderId);
}

/** Sweep: cancel unpaid orders past their payment deadline. Run every few minutes. */
export async function expireStaleOrders(gateway: PaymentGateway | null, now: Date, limit = 100): Promise<number> {
  const stale = await prisma.order.findMany({
    where: { status: "PENDING_PAYMENT", expiresAt: { lt: now } },
    orderBy: { expiresAt: "asc" },
    take: limit,
    select: { id: true },
  });
  let cancelled = 0;
  for (const order of stale) {
    try {
      if (await abandonOrder(gateway, order.id, now)) cancelled += 1;
    } catch (error) {
      console.error(`[orders] could not expire order ${order.id}`, error);
    }
  }
  return cancelled;
}

/** Before a new checkout, cancel the buyer's earlier unpaid orders in the same currency (they hold stock). */
export async function abandonPendingOrders(gateway: PaymentGateway | null, buyerId: string, currency: string): Promise<void> {
  const pending = await prisma.order.findMany({ where: { buyerId, currency, status: "PENDING_PAYMENT" }, select: { id: true } });
  for (const order of pending) await abandonOrder(gateway, order.id);
}
