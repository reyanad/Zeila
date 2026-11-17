import type { Prisma } from "@marketplace/database";
import { CheckoutError } from "./errors";

/**
 * Stock reservations. Every change is a single conditional UPDATE, so two
 * buyers can never both take the last unit: the second UPDATE matches no row.
 */

interface LevelCandidate {
  id: string;
  onHand: number;
  reserved: number;
  isDefault: boolean;
}

/** Hold `quantity` units across warehouses (default warehouse first) for an order item. */
export async function reserveStock(
  tx: Prisma.TransactionClient,
  params: { orderItemId: string; levels: LevelCandidate[]; quantity: number; expiresAt: Date; label: string },
): Promise<void> {
  let remaining = params.quantity;
  const ordered = [...params.levels].sort((a, b) => Number(b.isDefault) - Number(a.isDefault) || b.onHand - b.reserved - (a.onHand - a.reserved));
  for (const level of ordered) {
    if (remaining === 0) break;
    const take = Math.min(remaining, Math.max(0, level.onHand - level.reserved));
    if (take === 0) continue;
    const updated = await tx.$executeRaw`
      UPDATE "InventoryLevel" SET "reserved" = "reserved" + ${take}
      WHERE "id" = ${level.id} AND "onHand" - "reserved" >= ${take}`;
    if (updated !== 1) continue;
    await tx.inventoryReservation.create({
      data: { orderItemId: params.orderItemId, inventoryLevelId: level.id, quantity: take, expiresAt: params.expiresAt },
    });
    remaining -= take;
  }
  if (remaining > 0) throw new CheckoutError(`${params.label} just sold out or has fewer units left. Update your cart and try again.`);
}

/** Give held units back (order cancelled or expired). */
export async function releaseReservations(tx: Prisma.TransactionClient, orderId: string): Promise<void> {
  const held = await tx.inventoryReservation.findMany({ where: { status: "HELD", orderItem: { subOrder: { orderId } } } });
  for (const reservation of held) {
    await tx.$executeRaw`
      UPDATE "InventoryLevel" SET "reserved" = GREATEST("reserved" - ${reservation.quantity}, 0)
      WHERE "id" = ${reservation.inventoryLevelId}`;
    await tx.inventoryReservation.update({ where: { id: reservation.id }, data: { status: "RELEASED" } });
  }
}

/** Turn held units into sold units (order paid): both on-hand and reserved go down. */
export async function commitReservations(tx: Prisma.TransactionClient, orderId: string): Promise<void> {
  const held = await tx.inventoryReservation.findMany({ where: { status: "HELD", orderItem: { subOrder: { orderId } } } });
  for (const reservation of held) {
    await tx.$executeRaw`
      UPDATE "InventoryLevel"
      SET "onHand" = GREATEST("onHand" - ${reservation.quantity}, 0),
          "reserved" = GREATEST("reserved" - ${reservation.quantity}, 0)
      WHERE "id" = ${reservation.inventoryLevelId}`;
    await tx.inventoryReservation.update({ where: { id: reservation.id }, data: { status: "COMMITTED" } });
  }
}
