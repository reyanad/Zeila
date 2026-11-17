import type { Prisma, SubOrderStatus } from "@marketplace/database";
import { getSetting } from "./settings";

const DONE = ["COMPLETED", "REFUNDED", "CANCELLED"];
const DELIVERED = ["DELIVERED", ...DONE];

export interface ItemState {
  status: string;
  listingType: string;
}

/** Pure status decision for a sub-order from its items; see `rollupSubOrderStatus`. */
export function nextSubOrderStatus(current: SubOrderStatus, items: readonly ItemState[]): SubOrderStatus {
  const active = items.filter((item) => item.status !== "REFUNDED" && item.status !== "CANCELLED");
  const physical = active.filter((item) => item.listingType === "PHYSICAL");
  if (active.length === 0) return "REFUNDED";
  if (active.every((item) => DONE.includes(item.status))) return "COMPLETED";
  if (active.every((item) => DELIVERED.includes(item.status))) return "DELIVERED";
  if (active.some((item) => item.listingType === "SERVICE" && item.status === "FULFILLING")) return "IN_PROGRESS";
  if (physical.length > 0 && physical.every((item) => item.status !== "PENDING")) return "SHIPPED";
  if (active.some((item) => item.listingType === "SERVICE" && item.status !== "PENDING")) return "IN_PROGRESS";
  return current;
}

/**
 * Derive a sub-order's status from its items (a store's sub-order can mix
 * physical goods, downloads and services):
 *   every item done        -> COMPLETED
 *   every item delivered   -> DELIVERED (and the escrow hold window restarts)
 *   physical items shipped -> SHIPPED
 *   service work started   -> IN_PROGRESS
 * Statuses set by staff or refunds (REFUNDED, DISPUTED, CANCELLED) are kept.
 */
export async function rollupSubOrderStatus(tx: Prisma.TransactionClient, subOrderId: string, now: Date): Promise<SubOrderStatus> {
  const subOrder = await tx.subOrder.findUniqueOrThrow({
    where: { id: subOrderId },
    select: {
      status: true,
      deliveredAt: true,
      escrow: { select: { id: true, status: true } },
      items: { select: { status: true, listingType: true } },
    },
  });
  if (["REFUNDED", "CANCELLED", "DISPUTED", "PENDING_PAYMENT"].includes(subOrder.status)) return subOrder.status;

  const next = nextSubOrderStatus(subOrder.status, subOrder.items);
  if (next === subOrder.status) return next;
  await tx.subOrder.update({
    where: { id: subOrderId },
    data: {
      status: next,
      ...(next === "DELIVERED" ? { deliveredAt: now } : {}),
      ...(next === "SHIPPED" ? { shippedAt: now } : {}),
      ...(next === "COMPLETED" ? { completedAt: now } : {}),
    },
  });
  if (next === "DELIVERED" && subOrder.escrow?.status === "HELD") {
    // A fresh protection window starts when everything has been delivered.
    const holdDays = await getSetting("escrowHoldDays");
    await tx.escrow.update({ where: { id: subOrder.escrow.id }, data: { holdUntil: new Date(now.getTime() + holdDays * 86_400_000) } });
  }
  return next;
}
