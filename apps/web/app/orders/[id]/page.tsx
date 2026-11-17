import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@marketplace/database";
import { Alert, Badge, buttonVariants } from "@marketplace/ui";
import { ConfirmReceivedButton } from "@/components/orders/confirm-received-button";
import { PaymentPending } from "@/components/orders/payment-pending";
import { formatPrice } from "@/components/storefront/price";
import { requireUser } from "@/lib/auth/session";
import { ORDER_STATUS, SUB_ORDER_STATUS } from "@/lib/orders/labels";

export const metadata: Metadata = { title: "Order", robots: { index: false } };
export const dynamic = "force-dynamic";

interface AddressView {
  recipient?: string;
  phone?: string;
  line1?: string;
  line2?: string;
  city?: string;
  state?: string;
  country?: string;
}

export default async function OrderPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const user = await requireUser(`/orders/${id}`);
  const order = await prisma.order.findFirst({
    where: { id, buyerId: user.id },
    include: {
      subOrders: {
        include: {
          store: { select: { name: true, slug: true } },
          escrow: { select: { status: true, holdUntil: true } },
          items: {
            select: {
              id: true,
              titleSnapshot: true,
              variantSnapshot: true,
              quantity: true,
              unitPrice: true,
              lineTotal: true,
              listingType: true,
              downloadGrants: { select: { id: true, downloadsUsed: true, digitalAsset: { select: { fileName: true, downloadLimit: true } } } },
              licenseKey: { select: { key: true, status: true, activationsLimit: true } },
            },
          },
        },
      },
      payments: { orderBy: { createdAt: "desc" }, take: 1, select: { status: true, failureReason: true } },
    },
  });
  if (!order) notFound();

  const money = (amount: number) => formatPrice(amount, order.currency);
  const status = ORDER_STATUS[order.status] ?? { label: order.status, tone: "neutral" as const };
  const address = (order.shippingAddress ?? null) as AddressView | null;
  const payment = order.payments[0];
  const returnedFromPayment = query.paid === "1";

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-4 py-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Order {order.orderNumber}</h1>
          <p className="text-sm text-muted-foreground">Placed {order.placedAt.toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}</p>
        </div>
        <Badge tone={status.tone}>{status.label}</Badge>
      </div>

      {order.status === "PENDING_PAYMENT" ? (
        returnedFromPayment && payment?.status !== "FAILED" ? (
          <Alert tone="info">
            <PaymentPending />
          </Alert>
        ) : (
          <Alert tone="warning" title="Payment needed">
            {payment?.status === "FAILED" ? `Your last payment attempt failed: ${payment.failureReason ?? "declined"}. ` : ""}
            Your items are held until {order.expiresAt?.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }) ?? "soon"}.{" "}
            <Link href={`/checkout/pay/${order.id}`} className="font-medium underline underline-offset-4">
              Pay now
            </Link>
          </Alert>
        )
      ) : null}
      {order.status === "PAID" && returnedFromPayment ? (
        <Alert tone="success" title="Thank you, your payment is confirmed">
          The money is held in escrow. Sellers have been notified and are getting your order ready.
        </Alert>
      ) : null}
      {order.status === "CANCELLED" ? <Alert tone="info">This order was cancelled and the items were released. You were not charged.</Alert> : null}

      {order.subOrders.map((subOrder) => {
        const subStatus = SUB_ORDER_STATUS[subOrder.status] ?? { label: subOrder.status, tone: "neutral" as const };
        return (
          <section key={subOrder.id} className="flex flex-col gap-3 rounded-lg border border-border p-4" aria-label={`From ${subOrder.store.name}`}>
            <div className="flex items-center justify-between gap-3">
              <h2 className="font-medium">
                From{" "}
                <Link href={`/store/${subOrder.store.slug}`} className="hover:underline">
                  {subOrder.store.name}
                </Link>
              </h2>
              <Badge tone={subStatus.tone}>{subStatus.label}</Badge>
            </div>
            <ul className="flex flex-col divide-y divide-border text-sm">
              {subOrder.items.map((item) => {
                const label = typeof (item.variantSnapshot as { label?: unknown } | null)?.label === "string" ? (item.variantSnapshot as { label: string }).label : null;
                return (
                  <li key={item.id} className="flex flex-col gap-2 py-2">
                    <div className="flex justify-between gap-3">
                      <span>
                        {item.titleSnapshot}
                        {label ? <span className="block text-xs text-muted-foreground">{label}</span> : null}
                        <span className="block text-xs text-muted-foreground tabular-nums">
                          {item.quantity} × {money(item.unitPrice)}
                        </span>
                      </span>
                      <span className="tabular-nums">{money(item.lineTotal)}</span>
                    </div>
                    {item.downloadGrants.map((grant) => {
                      const limit = grant.digitalAsset.downloadLimit;
                      const left = limit === null ? null : Math.max(0, limit - grant.downloadsUsed);
                      return (
                        <div key={grant.id} className="flex flex-wrap items-center gap-3 rounded-md bg-muted/60 px-3 py-2">
                          {left === 0 ? (
                            <span className="text-xs text-muted-foreground">Download limit reached</span>
                          ) : (
                            <a href={`/api/downloads/${grant.id}`} className={buttonVariants({ size: "sm" })}>
                              Download {grant.digitalAsset.fileName}
                            </a>
                          )}
                          <span className="text-xs text-muted-foreground">{left === null ? "Unlimited downloads" : `${left} download${left === 1 ? "" : "s"} left`}</span>
                        </div>
                      );
                    })}
                    {item.licenseKey ? (
                      <div className="rounded-md border border-border px-3 py-2">
                        <span className="text-xs text-muted-foreground">Licence key ({item.licenseKey.activationsLimit} device{item.licenseKey.activationsLimit === 1 ? "" : "s"})</span>
                        <code className="block select-all font-mono text-sm">{item.licenseKey.key}</code>
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
            {subOrder.escrow?.status === "HELD" && (subOrder.status === "SHIPPED" || subOrder.status === "DELIVERED") ? (
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-md bg-muted/60 px-3 py-2 text-sm">
                <span>
                  Payment held in escrow until {subOrder.escrow.holdUntil.toLocaleDateString("en-GB", { dateStyle: "medium" })} unless you confirm sooner.
                </span>
                <ConfirmReceivedButton orderId={order.id} subOrderId={subOrder.id} storeName={subOrder.store.name} />
              </div>
            ) : null}
            {subOrder.escrow?.status === "FROZEN" ? <p className="text-sm text-muted-foreground">Payment is on hold while a dispute is reviewed.</p> : null}
            <dl className="grid grid-cols-[1fr_auto] gap-x-4 text-sm text-muted-foreground">
              {subOrder.discountTotal > 0 ? (
                <>
                  <dt>Discount</dt>
                  <dd className="text-right tabular-nums">−{money(subOrder.discountTotal)}</dd>
                </>
              ) : null}
              {subOrder.shippingTotal > 0 ? (
                <>
                  <dt>Shipping</dt>
                  <dd className="text-right tabular-nums">{money(subOrder.shippingTotal)}</dd>
                </>
              ) : null}
              {subOrder.taxTotal > 0 ? (
                <>
                  <dt>Tax</dt>
                  <dd className="text-right tabular-nums">{money(subOrder.taxTotal)}</dd>
                </>
              ) : null}
            </dl>
          </section>
        );
      })}

      <div className="grid gap-6 sm:grid-cols-2">
        {address ? (
          <section className="rounded-lg border border-border p-4 text-sm" aria-label="Delivery address">
            <h2 className="mb-2 font-medium">Delivery address</h2>
            <p>{address.recipient}</p>
            <p className="text-muted-foreground">{[address.line1, address.line2, address.city, address.state, address.country].filter(Boolean).join(", ")}</p>
            <p className="text-muted-foreground">{address.phone}</p>
          </section>
        ) : (
          <div />
        )}
        <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 self-start rounded-lg border border-border p-4 text-sm">
          <dt>Items</dt>
          <dd className="text-right tabular-nums">{money(order.itemsSubtotal)}</dd>
          {order.discountTotal > 0 ? (
            <>
              <dt>Discount{order.promoCode ? ` (${order.promoCode})` : ""}</dt>
              <dd className="text-right tabular-nums">−{money(order.discountTotal)}</dd>
            </>
          ) : null}
          <dt>Shipping</dt>
          <dd className="text-right tabular-nums">{money(order.shippingTotal)}</dd>
          <dt>Tax</dt>
          <dd className="text-right tabular-nums">{money(order.taxTotal)}</dd>
          <dt className="border-t border-border pt-2 font-semibold">Total</dt>
          <dd className="border-t border-border pt-2 text-right font-semibold tabular-nums">{money(order.grandTotal)}</dd>
        </dl>
      </div>
      <Link href="/orders" className={buttonVariants({ variant: "ghost", size: "sm" })}>
        All orders
      </Link>
    </div>
  );
}
