import type { PaymentGateway } from "./gateway";
import { prisma, type Prisma } from "@marketplace/database";
import { isCarrierCode, trackingUrl } from "@marketplace/shared-types";
import { sellerSubOrderId } from "./access";
import { CheckoutError } from "./errors";
import { rollupOrderStatus } from "./fulfillment";
import { notifySubOrder } from "./notifications";
import { refundSubOrder } from "./refunds";
import { rollupSubOrderStatus } from "./status";

export interface TrackingEvent {
  at: string;
  status: "LABEL_CREATED" | "IN_TRANSIT" | "OUT_FOR_DELIVERY" | "DELIVERED" | "DELIVERY_FAILED" | "RETURNED";
  location: string | null;
  note: string | null;
}

function appendEvent(existing: Prisma.JsonValue, event: TrackingEvent): Prisma.InputJsonValue {
  const events = Array.isArray(existing) ? existing : [];
  return [...events, { ...event }] as Prisma.InputJsonValue;
}

/** Seller has started packing. */
export async function markPreparing(sellerUserId: string, subOrderId: string): Promise<void> {
  const subOrder = await sellerSubOrderId(sellerUserId, subOrderId);
  if (subOrder.status !== "PAID") throw new CheckoutError("Only newly paid orders can be marked as preparing.");
  await prisma.subOrder.update({ where: { id: subOrder.id }, data: { status: "PROCESSING" } });
}

export interface ShipInput {
  carrier: string;
  trackingNumber: string | null;
  service: string | null;
}

/** Hand the physical items to a carrier. */
export async function shipSubOrder(sellerUserId: string, subOrderId: string, input: ShipInput, now: Date): Promise<void> {
  const subOrder = await sellerSubOrderId(sellerUserId, subOrderId);
  if (!["PAID", "PROCESSING", "IN_PROGRESS"].includes(subOrder.status)) throw new CheckoutError("This order cannot be shipped in its current state.");
  if (!isCarrierCode(input.carrier)) throw new CheckoutError("Choose a carrier.");
  if (input.carrier !== "local" && !input.trackingNumber) throw new CheckoutError("Enter the tracking number from the carrier.");

  await prisma.$transaction(async (tx) => {
    const pending = await tx.orderItem.findMany({ where: { subOrderId: subOrder.id, listingType: "PHYSICAL", status: "PENDING" }, select: { id: true } });
    if (pending.length === 0) throw new CheckoutError("There are no items left to ship.");
    await tx.shipment.create({
      data: {
        subOrderId: subOrder.id,
        carrier: input.carrier,
        service: input.service,
        trackingNumber: input.trackingNumber,
        trackingUrl: trackingUrl(input.carrier, input.trackingNumber),
        status: "IN_TRANSIT",
        shippedAt: now,
        events: [{ at: now.toISOString(), status: "IN_TRANSIT", location: null, note: "Handed to the carrier" }],
      },
    });
    await tx.orderItem.updateMany({ where: { id: { in: pending.map((item) => item.id) } }, data: { status: "FULFILLING" } });
    await rollupSubOrderStatus(tx, subOrder.id, now);
    await rollupOrderStatus(tx, subOrder.orderId);
  });
  await notifySubOrder(subOrder.id, "buyer", {
    type: "ORDER_SHIPPED",
    title: "{store} shipped your order {order}",
    body: input.trackingNumber ? `Tracking number: ${input.trackingNumber}` : "The seller is delivering it themselves.",
  });
}

/** Add a tracking update; DELIVERED completes delivery of the shipment's items. */
export async function addTrackingEvent(sellerUserId: string, shipmentId: string, event: Omit<TrackingEvent, "at">, now: Date): Promise<void> {
  const shipment = await prisma.shipment.findFirst({ where: { id: shipmentId, subOrder: { store: { sellerId: sellerUserId } } }, select: { id: true, subOrderId: true, events: true, status: true } });
  if (!shipment) throw new CheckoutError("That shipment does not exist.");
  if (shipment.status === "DELIVERED") throw new CheckoutError("This shipment was already delivered.");
  await prisma.$transaction(async (tx) => {
    await tx.shipment.update({
      where: { id: shipment.id },
      data: {
        status: event.status,
        events: appendEvent(shipment.events, { ...event, at: now.toISOString() }),
        ...(event.status === "DELIVERED" ? { deliveredAt: now } : {}),
      },
    });
    if (event.status === "DELIVERED") {
      await tx.orderItem.updateMany({ where: { subOrderId: shipment.subOrderId, listingType: "PHYSICAL", status: "FULFILLING" }, data: { status: "DELIVERED", deliveredAt: now } });
      const subOrder = await tx.subOrder.findUniqueOrThrow({ where: { id: shipment.subOrderId }, select: { orderId: true } });
      await rollupSubOrderStatus(tx, shipment.subOrderId, now);
      await rollupOrderStatus(tx, subOrder.orderId);
    }
  });
  if (event.status === "DELIVERED") {
    await notifySubOrder(shipment.subOrderId, "buyer", {
      type: "ORDER_DELIVERED",
      title: "Your order {order} was delivered",
      body: "Check everything arrived as described. You can confirm, or report a problem while the seller's payment is held.",
    });
  }
}

/** Seller cannot fulfil: full refund to the buyer and stock back on the shelf. Only before shipping. */
export async function cancelBySeller(gateway: PaymentGateway | null, sellerUserId: string, subOrderId: string, reason: string, now: Date): Promise<void> {
  const subOrder = await sellerSubOrderId(sellerUserId, subOrderId);
  if (!["PAID", "PROCESSING"].includes(subOrder.status)) throw new CheckoutError("Orders can only be cancelled before anything is shipped or delivered.");
  const details = await prisma.subOrder.findUniqueOrThrow({
    where: { id: subOrder.id },
    select: { grandTotal: true, refundedTotal: true, items: { select: { id: true, listingType: true, quantity: true, status: true } } },
  });
  if (details.items.some((item) => item.status !== "PENDING" && item.listingType !== "DIGITAL")) {
    throw new CheckoutError("Part of this order is already delivered or in progress.");
  }
  await refundSubOrder(
    gateway,
    {
      subOrderId: subOrder.id,
      amount: details.grandTotal - details.refundedTotal,
      reason: `Cancelled by seller: ${reason}`,
      idempotencyKey: `seller-cancel:${subOrder.id}`,
      refundedItemIds: details.items.map((item) => item.id),
      restock: details.items.filter((item) => item.listingType === "PHYSICAL").map((item) => ({ orderItemId: item.id, quantity: item.quantity })),
    },
    now,
  );
}
