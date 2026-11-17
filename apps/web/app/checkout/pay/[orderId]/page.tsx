import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { CheckoutError, ensurePaymentIntent } from "@marketplace/core";
import { prisma } from "@marketplace/database";
import { Alert, buttonVariants } from "@marketplace/ui";
import { PaymentForm } from "@/components/checkout/payment-form";
import { formatPrice } from "@/components/storefront/price";
import { requireUser } from "@/lib/auth/session";
import { appUrl, stripePublishableKey } from "@/lib/env";
import { getStripe, stripeErrorMessage } from "@/lib/stripe";

export const metadata: Metadata = { title: "Payment", robots: { index: false } };
export const dynamic = "force-dynamic";

export default async function PayPage({ params }: { params: Promise<{ orderId: string }> }) {
  const { orderId } = await params;
  const user = await requireUser(`/checkout/pay/${orderId}`);
  const order = await prisma.order.findFirst({
    where: { id: orderId, buyerId: user.id },
    select: { id: true, orderNumber: true, status: true, grandTotal: true, currency: true, expiresAt: true },
  });
  if (!order) notFound();
  if (order.status !== "PENDING_PAYMENT") redirect(`/orders/${order.id}`);

  const stripe = getStripe();
  const publishableKey = stripePublishableKey();
  let clientSecret: string | null = null;
  let problem: string | null = null;
  if (!stripe || !publishableKey) {
    problem = "Card payments are not available yet: the platform has not configured Stripe.";
  } else {
    try {
      clientSecret = (await ensurePaymentIntent(stripe, order.id)).clientSecret;
    } catch (error) {
      problem = error instanceof CheckoutError ? error.message : stripeErrorMessage(error);
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-lg flex-col gap-6 px-4 py-10">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Pay for order {order.orderNumber}</h1>
        <p className="text-sm text-muted-foreground">
          {formatPrice(order.grandTotal, order.currency)}
          {order.expiresAt ? ` · items held until ${order.expiresAt.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}` : ""}
        </p>
      </div>
      {problem || !clientSecret || !publishableKey ? (
        <Alert tone="danger">
          {problem ?? "Payment could not start."}{" "}
          <Link href={`/orders/${order.id}`} className="font-medium underline underline-offset-4">
            View order
          </Link>
        </Alert>
      ) : (
        <PaymentForm
          publishableKey={publishableKey}
          clientSecret={clientSecret}
          returnUrl={appUrl(`/orders/${order.id}?paid=1`)}
          label={`Pay ${formatPrice(order.grandTotal, order.currency)}`}
        />
      )}
      <p className="text-xs text-muted-foreground">
        Payments are processed by Stripe. Your money is held in escrow and released to sellers after delivery or approval.
      </p>
      <Link href="/cart" className={buttonVariants({ variant: "ghost", size: "sm" })}>
        Back to cart
      </Link>
    </div>
  );
}
