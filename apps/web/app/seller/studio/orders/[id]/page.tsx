import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { suggestedReturnRefund } from "@marketplace/core";
import { prisma } from "@marketplace/database";
import { minorToInput, RETURN_REASONS, isReturnReason } from "@marketplace/shared-types";
import { Alert, Badge, buttonVariants } from "@marketplace/ui";
import { ActionButton } from "@/components/action-button";
import { DeliveryForm } from "@/components/orders/delivery-form";
import { ReturnDecision } from "@/components/orders/return-decision";
import { ReturnRefundForm } from "@/components/orders/return-refund-form";
import { ShipForm } from "@/components/orders/ship-form";
import { Tracking } from "@/components/orders/tracking";
import { WorkThread } from "@/components/orders/work-thread";
import { formatPrice } from "@/components/storefront/price";
import { cancelOrderAction, markPreparingAction, startWorkAction, trackingEventAction } from "@/lib/actions/fulfilment";
import { SUB_ORDER_STATUS } from "@/lib/orders/labels";
import { loadWork } from "@/lib/orders/work";
import { requireStudio } from "@/lib/studio/context";

export const metadata: Metadata = { title: "Order", robots: { index: false } };
export const dynamic = "force-dynamic";

const RMA_LABEL: Record<string, string> = {
  REQUESTED: "Return requested",
  APPROVED: "Approved, waiting for the parcel",
  AWAITING_RETURN: "Buyer has sent it back",
  RECEIVED: "Received",
  REFUNDED: "Refunded",
  REJECTED: "Declined",
  REPLACED: "Replaced",
  CLOSED: "Closed",
};

interface AddressView {
  recipient?: string;
  phone?: string;
  line1?: string;
  line2?: string;
  city?: string;
  state?: string;
  country?: string;
}

export default async function SellerOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { store } = await requireStudio(`/seller/studio/orders/${id}`);
  const subOrder = await prisma.subOrder.findFirst({
    where: { id, storeId: store.id, status: { not: "PENDING_PAYMENT" } },
    select: {
      id: true,
      status: true,
      currency: true,
      grandTotal: true,
      platformFee: true,
      refundedTotal: true,
      shippingTotal: true,
      order: { select: { orderNumber: true, placedAt: true, shippingAddress: true, buyer: { select: { name: true } } } },
      escrow: { select: { status: true, amount: true, refunded: true, holdUntil: true, frozenReason: true } },
      disputes: { where: { status: { in: ["OPEN", "AWAITING_SELLER", "AWAITING_BUYER", "UNDER_REVIEW"] } }, select: { id: true, kind: true, respondBy: true }, take: 1 },
      shipments: { orderBy: { createdAt: "asc" }, select: { id: true, carrier: true, trackingNumber: true, trackingUrl: true, status: true, events: true } },
      items: {
        orderBy: { id: "asc" },
        select: {
          id: true,
          titleSnapshot: true,
          variantSnapshot: true,
          quantity: true,
          lineTotal: true,
          listingType: true,
          status: true,
          rmaRequests: {
            orderBy: { createdAt: "desc" },
            select: { id: true, reason: true, details: true, quantity: true, status: true, returnTrackingNumber: true, sellerNote: true, refundAmount: true, createdAt: true },
          },
        },
      },
    },
  });
  if (!subOrder) notFound();

  const money = (amount: number) => formatPrice(amount, subOrder.currency);
  const status = SUB_ORDER_STATUS[subOrder.status] ?? { label: subOrder.status, tone: "neutral" as const };
  const physical = subOrder.items.filter((item) => item.listingType === "PHYSICAL");
  const services = subOrder.items.filter((item) => item.listingType === "SERVICE");
  const canShip = ["PAID", "PROCESSING", "IN_PROGRESS"].includes(subOrder.status) && physical.some((item) => item.status === "PENDING");
  const canCancel = ["PAID", "PROCESSING"].includes(subOrder.status) && subOrder.items.every((item) => item.status === "PENDING" || item.listingType === "DIGITAL");
  const works = new Map((await Promise.all(services.map((item) => loadWork(item.id)))).flatMap((work) => (work ? [[work.orderItemId, work] as const] : [])));
  const address = (subOrder.order.shippingAddress ?? null) as AddressView | null;
  const escrow = subOrder.escrow;
  const remaining = subOrder.grandTotal - subOrder.refundedTotal;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Order {subOrder.order.orderNumber}</h1>
          <p className="text-sm text-muted-foreground">
            {subOrder.order.buyer.name ?? "Buyer"} · placed {subOrder.order.placedAt.toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}
          </p>
        </div>
        <Badge tone={status.tone}>{status.label}</Badge>
      </div>

      {subOrder.disputes[0] ? (
        <Alert tone="danger" title={subOrder.disputes[0].kind === "CHARGEBACK" ? "Card dispute open" : "The buyer opened a case"}>
          {subOrder.disputes[0].respondBy ? `Reply by ${subOrder.disputes[0].respondBy.toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}. ` : ""}
          <Link href={`/disputes/${subOrder.disputes[0].id}`} className="font-medium underline underline-offset-4">
            Open the case
          </Link>
        </Alert>
      ) : null}

      {escrow ? (
        <Alert tone={escrow.status === "FROZEN" ? "warning" : "info"} title="Your payment">
          {escrow.status === "HELD"
            ? `${money(escrow.amount - escrow.refunded)} is held in escrow and is paid out ${escrow.holdUntil.toLocaleDateString("en-GB", { dateStyle: "medium" })} after delivery, or sooner when the buyer confirms.`
            : escrow.status === "FROZEN"
              ? `${money(escrow.amount - escrow.refunded)} is on hold: ${escrow.frozenReason ?? "under review"}.`
              : escrow.status === "RELEASED"
                ? "Released to your balance."
                : "Refunded to the buyer."}{" "}
          Commission: {money(subOrder.platformFee)}.{subOrder.refundedTotal > 0 ? ` Refunded so far: ${money(subOrder.refundedTotal)}.` : ""}
        </Alert>
      ) : null}

      <section className="flex flex-col gap-3 rounded-lg border border-border p-4" aria-label="Items">
        <h2 className="font-medium">Items</h2>
        <ul className="flex flex-col divide-y divide-border text-sm">
          {subOrder.items.map((item) => {
            const label = typeof (item.variantSnapshot as { label?: unknown } | null)?.label === "string" ? (item.variantSnapshot as { label: string }).label : null;
            return (
              <li key={item.id} className="flex flex-col gap-3 py-3">
                <div className="flex justify-between gap-3">
                  <span>
                    {item.quantity} × {item.titleSnapshot}
                    {label ? <span className="block text-xs text-muted-foreground">{label}</span> : null}
                    <span className="block text-xs text-muted-foreground">
                      {item.listingType === "PHYSICAL" ? "Physical" : item.listingType === "DIGITAL" ? "Download, delivered automatically" : "Service"} · {item.status.toLowerCase()}
                    </span>
                  </span>
                  <span className="tabular-nums">{money(item.lineTotal)}</span>
                </div>

                {item.rmaRequests.map((rma) => (
                  <div key={rma.id} className="flex flex-col gap-2 rounded-md border border-border p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-medium">
                        Return of {rma.quantity}: {isReturnReason(rma.reason) ? RETURN_REASONS[rma.reason] : rma.reason}
                      </span>
                      <Badge tone={rma.status === "REFUNDED" ? "success" : rma.status === "REJECTED" ? "neutral" : "warning"}>{RMA_LABEL[rma.status] ?? rma.status}</Badge>
                    </div>
                    {rma.details ? <p className="whitespace-pre-wrap text-muted-foreground">{rma.details}</p> : null}
                    {rma.returnTrackingNumber ? <p className="text-xs">Return tracking: {rma.returnTrackingNumber}</p> : null}
                    {rma.status === "REQUESTED" ? <ReturnDecision subOrderId={subOrder.id} rmaId={rma.id} /> : null}
                    {["APPROVED", "AWAITING_RETURN", "RECEIVED"].includes(rma.status) ? (
                      <ReturnRefundForm
                        subOrderId={subOrder.id}
                        rmaId={rma.id}
                        currency={subOrder.currency}
                        suggested={minorToInput(Math.min(remaining, suggestedReturnRefund(item.lineTotal, item.quantity, rma.quantity)))}
                      />
                    ) : null}
                    {rma.status === "REFUNDED" && rma.refundAmount !== null ? <p className="text-xs text-muted-foreground">Refunded {money(rma.refundAmount)}.</p> : null}
                  </div>
                ))}

                {item.listingType === "SERVICE" ? (
                  <div className="flex flex-col gap-3 rounded-md border border-border p-3">
                    {works.get(item.id) ? <WorkThread work={works.get(item.id)!} viewer="seller" /> : null}
                    {item.status === "PENDING" && subOrder.status !== "REFUNDED" ? (
                      <ActionButton action={startWorkAction.bind(null, subOrder.id, item.id)} label="Start work" pendingLabel="Starting…" />
                    ) : null}
                    {item.status === "FULFILLING" ? <DeliveryForm subOrderId={subOrder.id} orderItemId={item.id} /> : null}
                    {item.status === "DELIVERED" ? <p className="text-xs text-muted-foreground">Waiting for the buyer to approve or ask for changes. It is approved automatically when the protection window ends.</p> : null}
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      </section>

      {physical.length > 0 ? (
        <section className="flex flex-col gap-3 rounded-lg border border-border p-4" aria-label="Shipping">
          <h2 className="font-medium">Shipping</h2>
          {address ? (
            <p className="text-sm">
              {address.recipient} · {address.phone}
              <span className="block text-muted-foreground">{[address.line1, address.line2, address.city, address.state, address.country].filter(Boolean).join(", ")}</span>
            </p>
          ) : null}
          {subOrder.shipments.map((shipment) => (
            <div key={shipment.id} className="flex flex-col gap-2">
              <Tracking shipment={shipment} />
              {shipment.status !== "DELIVERED" ? (
                <div className="flex flex-wrap gap-2">
                  <ActionButton variant="outline" action={trackingEventAction.bind(null, subOrder.id, shipment.id, "OUT_FOR_DELIVERY")} label="Out for delivery" />
                  <ActionButton action={trackingEventAction.bind(null, subOrder.id, shipment.id, "DELIVERED")} label="Delivered" confirm="Mark this parcel as delivered? The buyer's protection window starts now." />
                  <ActionButton variant="ghost" action={trackingEventAction.bind(null, subOrder.id, shipment.id, "DELIVERY_FAILED")} label="Delivery failed" />
                </div>
              ) : null}
            </div>
          ))}
          {subOrder.status === "PAID" && canShip ? <ActionButton variant="outline" action={markPreparingAction.bind(null, subOrder.id)} label="Mark as preparing" /> : null}
          {canShip ? <ShipForm subOrderId={subOrder.id} /> : null}
        </section>
      ) : null}

      {canCancel ? (
        <section className="flex flex-col gap-2 rounded-lg border border-border p-4" aria-label="Cancel">
          <h2 className="font-medium">Can't fulfil this order?</h2>
          <p className="text-sm text-muted-foreground">Cancelling refunds the buyer in full ({money(remaining)}) and returns the stock. Frequent cancellations affect your store's standing.</p>
          <div>
            <ActionButton
              variant="destructive"
              action={cancelOrderAction.bind(null, subOrder.id, "Seller could not fulfil the order")}
              label="Cancel and refund"
              pendingLabel="Refunding…"
              confirm="Cancel this order and refund the buyer in full? This cannot be undone."
            />
          </div>
        </section>
      ) : null}

      <Link href="/seller/studio/orders" className={buttonVariants({ variant: "ghost", size: "sm" })}>
        All orders
      </Link>
    </div>
  );
}
