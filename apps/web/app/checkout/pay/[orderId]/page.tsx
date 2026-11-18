import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { prisma } from "@marketplace/database";
import { Alert, buttonVariants } from "@marketplace/ui";
import { ChapaPayForm } from "@/components/checkout/chapa-pay-form";
import { formatPrice } from "@/components/storefront/price";
import { requireUser } from "@/lib/auth/session";
import { getChapa } from "@/lib/chapa";

export const metadata: Metadata = { title: "Payment", robots: { index: false } };
export const dynamic = "force-dynamic";

const RETURN_MESSAGES: Record<string, { tone: "info" | "warning" | "danger"; text: string }> = {
  pending: { tone: "info", text: "Chapa is still confirming your payment. This page updates once it is confirmed; you will not be charged twice." },
  failed: { tone: "danger", text: "The payment did not go through. You can try again with the same or another method." },
  cancelled: { tone: "warning", text: "The payment was not completed. Your items are still held for you until the time below." },
};

export default async function PayPage({
  params,
  searchParams,
}: {
  params: Promise<{ orderId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { orderId } = await params;
  const query = await searchParams;
  const user = await requireUser(`/checkout/pay/${orderId}`);
  const order = await prisma.order.findFirst({
    where: { id: orderId, buyerId: user.id },
    select: { id: true, orderNumber: true, status: true, grandTotal: true, currency: true, expiresAt: true },
  });
  if (!order) notFound();
  if (order.status !== "PENDING_PAYMENT") redirect(`/orders/${order.id}`);

  const configured = getChapa() !== null;
  const notice = typeof query.payment === "string" ? RETURN_MESSAGES[query.payment] : undefined;
  const total = formatPrice(order.grandTotal, order.currency);

  return (
    <div className="mx-auto flex w-full max-w-lg flex-col gap-6 px-4 py-10">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Pay for order {order.orderNumber}</h1>
        <p className="text-sm text-muted-foreground">
          {total}
          {order.expiresAt ? ` · items held until ${order.expiresAt.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}` : ""}
        </p>
      </div>
      {notice ? <Alert tone={notice.tone}>{notice.text}</Alert> : null}
      {configured ? (
        <div className="flex flex-col gap-3 rounded-lg border border-border p-4">
          <p className="text-sm">
            You will pay on Chapa&apos;s secure page with telebirr, CBE Birr, M-Pesa, a bank account or a card, then come back here.
          </p>
          <ChapaPayForm orderId={order.id} label={`Pay ${total} with Chapa`} />
        </div>
      ) : (
        <Alert tone="danger">
          Payments are not available yet: the platform has not finished its Chapa setup.{" "}
          <Link href={`/orders/${order.id}`} className="font-medium underline underline-offset-4">
            View order
          </Link>
        </Alert>
      )}
      <p className="text-xs text-muted-foreground">
        Payments are processed by Chapa. Your money is held safely and released to sellers only after delivery or your approval.
      </p>
      <Link href="/cart" className={buttonVariants({ variant: "ghost", size: "sm" })}>
        Back to cart
      </Link>
    </div>
  );
}
