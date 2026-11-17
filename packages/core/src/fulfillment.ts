import { randomInt } from "node:crypto";
import type { Prisma } from "@marketplace/database";
import { accounts, postEntry, type EntryLine } from "./ledger";

/**
 * What happens the moment an order is paid, inside the payment transaction:
 * the ledger entry, one escrow per store, and instant delivery of digital
 * products (download grants and licence keys).
 */

export interface SubOrderMoney {
  storeId: string;
  itemsSubtotal: number;
  discountTotal: number;
  shippingTotal: number;
  taxTotal: number;
  grandTotal: number;
  platformFee: number;
}

export interface Settlement {
  /** What the store is owed before commission. */
  entitlement: number;
  fee: number;
  /** Discount the platform pays for (platform-wide promo codes). */
  platformDiscount: number;
  /** Held in escrow and eventually transferred to the store. */
  escrowAmount: number;
}

/**
 * Split one sub-order's money. A store-funded discount lowers what the store
 * earns; a platform-funded discount does not (the platform pays it).
 */
export function settleSubOrder(subOrder: SubOrderMoney, promoFundedBy: "store" | "platform" | null): Settlement {
  const platformDiscount = promoFundedBy === "platform" ? subOrder.discountTotal : 0;
  const entitlement = subOrder.grandTotal + platformDiscount;
  const fee = Math.min(subOrder.platformFee, entitlement);
  return { entitlement, fee, platformDiscount, escrowAmount: entitlement - fee };
}

/** The ledger lines for a paid order (exported for tests). */
export function paidOrderLines(currency: string, grandTotal: number, subOrders: Array<{ money: SubOrderMoney; settlement: Settlement }>): EntryLine[] {
  const lines: EntryLine[] = [{ account: accounts.cash(currency), direction: "DEBIT", amount: grandTotal }];
  for (const { money, settlement } of subOrders) {
    lines.push({ account: accounts.escrow(money.storeId, currency), direction: "CREDIT", amount: settlement.escrowAmount });
    lines.push({ account: accounts.fees(currency), direction: "CREDIT", amount: settlement.fee });
    lines.push({ account: accounts.promotions(currency), direction: "DEBIT", amount: settlement.platformDiscount });
  }
  return lines;
}

const KEY_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I

/** Fill a licence template: every {{BLOCKn}} becomes n random characters. */
export function generateLicenseKey(template: string): string {
  return template.replace(/\{\{BLOCK(\d)\}\}/g, (_match, size: string) =>
    Array.from({ length: Number(size) }, () => KEY_ALPHABET[randomInt(KEY_ALPHABET.length)]).join(""),
  );
}

function promoFunding(metadata: Prisma.JsonValue): "store" | "platform" | null {
  if (typeof metadata !== "object" || metadata === null || Array.isArray(metadata)) return null;
  const promo = (metadata as Record<string, unknown>).promo;
  if (typeof promo !== "object" || promo === null) return null;
  const fundedBy = (promo as Record<string, unknown>).fundedBy;
  return fundedBy === "store" || fundedBy === "platform" ? fundedBy : null;
}

export async function fulfillPaidOrder(tx: Prisma.TransactionClient, orderId: string, paidAt: Date, escrowHoldDays: number): Promise<void> {
  const order = await tx.order.findUniqueOrThrow({
    where: { id: orderId },
    select: {
      id: true,
      orderNumber: true,
      currency: true,
      grandTotal: true,
      metadata: true,
      buyerId: true,
      subOrders: {
        select: {
          id: true,
          storeId: true,
          itemsSubtotal: true,
          discountTotal: true,
          shippingTotal: true,
          taxTotal: true,
          grandTotal: true,
          platformFee: true,
          items: {
            select: {
              id: true,
              listingType: true,
              listing: { select: { digitalAsset: { select: { id: true, licenseTemplate: true, activationsLimit: true } } } },
            },
          },
        },
      },
    },
  });

  const fundedBy = promoFunding(order.metadata);
  const settled = order.subOrders.map((subOrder) => ({ subOrder, money: subOrder as SubOrderMoney, settlement: settleSubOrder(subOrder, fundedBy) }));

  if (order.grandTotal > 0 || settled.some(({ settlement }) => settlement.platformDiscount > 0)) {
    await postEntry(tx, {
      idempotencyKey: `order-paid:${order.id}`,
      description: `Payment for order ${order.orderNumber}`,
      occurredAt: paidAt,
      metadata: { orderId: order.id },
      lines: paidOrderLines(order.currency, order.grandTotal, settled),
    });
  }

  const holdUntil = new Date(paidAt.getTime() + escrowHoldDays * 86_400_000);
  for (const { subOrder, settlement } of settled) {
    await tx.escrow.create({ data: { subOrderId: subOrder.id, amount: settlement.escrowAmount, status: "HELD", holdUntil } });

    let allDelivered = subOrder.items.length > 0;
    for (const item of subOrder.items) {
      const asset = item.listing.digitalAsset;
      if (item.listingType !== "DIGITAL" || !asset) {
        allDelivered = false;
        continue;
      }
      await tx.downloadGrant.create({ data: { digitalAssetId: asset.id, orderItemId: item.id } });
      if (asset.licenseTemplate) {
        await tx.licenseKey.create({
          data: {
            digitalAssetId: asset.id,
            orderItemId: item.id,
            ownerId: order.buyerId,
            key: generateLicenseKey(asset.licenseTemplate),
            status: "ACTIVE",
            activationsLimit: asset.activationsLimit,
          },
        });
      }
      await tx.orderItem.update({ where: { id: item.id }, data: { status: "DELIVERED", deliveredAt: paidAt } });
    }
    if (allDelivered) await tx.subOrder.update({ where: { id: subOrder.id }, data: { status: "DELIVERED", deliveredAt: paidAt } });
  }
  await rollupOrderStatus(tx, order.id);
}

/** Derive the order's status from its sub-orders. */
export async function rollupOrderStatus(tx: Prisma.TransactionClient, orderId: string): Promise<void> {
  const subOrders = await tx.subOrder.findMany({ where: { orderId }, select: { status: true } });
  const statuses = subOrders.map((subOrder) => subOrder.status);
  const all = (allowed: string[]) => statuses.length > 0 && statuses.every((status) => allowed.includes(status));
  const some = (allowed: string[]) => statuses.some((status) => allowed.includes(status));

  let next: "PAID" | "PARTIALLY_FULFILLED" | "FULFILLED" | "COMPLETED" | "REFUNDED" | null = null;
  if (all(["REFUNDED", "CANCELLED"]) && some(["REFUNDED"])) next = "REFUNDED";
  else if (all(["COMPLETED", "REFUNDED", "CANCELLED"])) next = "COMPLETED";
  else if (all(["DELIVERED", "COMPLETED", "REFUNDED", "CANCELLED"])) next = "FULFILLED";
  else if (some(["SHIPPED", "DELIVERED", "COMPLETED", "SUBMITTED", "IN_PROGRESS"])) next = "PARTIALLY_FULFILLED";
  if (!next) return;
  await tx.order.updateMany({
    where: { id: orderId, status: { notIn: ["PENDING_PAYMENT", "CANCELLED"] } },
    data: { status: next, ...(next === "COMPLETED" ? { completedAt: new Date() } : {}) },
  });
}
