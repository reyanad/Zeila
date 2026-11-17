import type Stripe from "stripe";
import { prisma } from "@marketplace/database";
import { CheckoutError } from "./errors";

/**
 * Stripe PaymentIntent for an order. Funds flow is "separate charges and
 * transfers": the platform takes the payment; each store's share is
 * transferred to its connected account when escrow releases. `transfer_group`
 * ties those later transfers to this charge.
 */
export async function ensurePaymentIntent(stripe: Stripe, orderId: string): Promise<{ clientSecret: string }> {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: { id: true, orderNumber: true, grandTotal: true, currency: true, status: true, buyer: { select: { email: true } }, payments: { orderBy: { createdAt: "desc" }, take: 1 } },
  });
  if (!order) throw new CheckoutError("That order does not exist.");
  if (order.status !== "PENDING_PAYMENT") throw new CheckoutError("This order is no longer waiting for payment.");

  const existing = order.payments[0];
  if (existing && existing.status !== "CANCELLED" && existing.status !== "FAILED") {
    const intent = await stripe.paymentIntents.retrieve(existing.stripePaymentIntentId);
    if (intent.client_secret && intent.status !== "canceled") return { clientSecret: intent.client_secret };
  }

  const intent = await stripe.paymentIntents.create(
    {
      amount: order.grandTotal,
      currency: order.currency.toLowerCase(),
      automatic_payment_methods: { enabled: true },
      transfer_group: order.id,
      description: `Order ${order.orderNumber}`,
      receipt_email: order.buyer.email,
      metadata: { orderId: order.id, orderNumber: order.orderNumber },
    },
    { idempotencyKey: `order-payment-${order.id}-${order.payments.length}` },
  );
  if (!intent.client_secret) throw new Error(`PaymentIntent ${intent.id} has no client secret`);
  await prisma.payment.upsert({
    where: { stripePaymentIntentId: intent.id },
    create: { orderId: order.id, stripePaymentIntentId: intent.id, amount: order.grandTotal, currency: order.currency, status: "REQUIRES_ACTION" },
    update: {},
  });
  return { clientSecret: intent.client_secret };
}
