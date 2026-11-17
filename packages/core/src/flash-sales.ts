import { prisma, type Prisma } from "@marketplace/database";
import { discountedUnitPrice } from "@marketplace/shared-types";
import { CheckoutError } from "./errors";

/**
 * Flash sales: a store discounts chosen listings for a time window, optionally
 * for a limited number of units. Sale units are claimed when the order is
 * placed (one conditional UPDATE, so the cap can never be oversold) and given
 * back if the order is never paid.
 */

export interface FlashDeal {
  flashSaleId: string;
  name: string;
  discountBps: number;
  endsAt: Date;
  /** Units left at the sale price; null = no limit. */
  remaining: number | null;
}

export const FLASH_LIMITS = { minBps: 500, maxBps: 9_000, maxHours: 14 * 24, maxListings: 100 } as const;

/** The best live deal per listing. */
export async function activeFlashDeals(listingIds: readonly string[], now: Date): Promise<Map<string, FlashDeal>> {
  const deals = new Map<string, FlashDeal>();
  if (listingIds.length === 0) return deals;
  const rows = await prisma.flashSaleListing.findMany({
    where: {
      listingId: { in: [...new Set(listingIds)] },
      flashSale: { isActive: true, startsAt: { lte: now }, endsAt: { gt: now } },
    },
    select: { listingId: true, quantityCap: true, soldCount: true, flashSale: { select: { id: true, name: true, discountBps: true, endsAt: true } } },
  });
  for (const row of rows) {
    const remaining = row.quantityCap === null ? null : Math.max(0, row.quantityCap - row.soldCount);
    if (remaining === 0) continue;
    const current = deals.get(row.listingId);
    if (!current || row.flashSale.discountBps > current.discountBps) {
      deals.set(row.listingId, { flashSaleId: row.flashSale.id, name: row.flashSale.name, discountBps: row.flashSale.discountBps, endsAt: row.flashSale.endsAt, remaining });
    }
  }
  return deals;
}

/** Sale price for a line, or the normal price when the deal cannot cover the quantity. */
export function applyFlash(unitPrice: number, quantity: number, deal: FlashDeal | undefined): { unitPrice: number; deal: FlashDeal | null } {
  if (!deal || (deal.remaining !== null && quantity > deal.remaining)) return { unitPrice, deal: null };
  return { unitPrice: discountedUnitPrice(unitPrice, deal.discountBps), deal };
}

/** Claim sale units for an order line; throws when the capped quantity just sold out. */
export async function claimFlashUnits(tx: Prisma.TransactionClient, flashSaleId: string, listingId: string, quantity: number, label: string): Promise<void> {
  const updated = await tx.$executeRaw`
    UPDATE "FlashSaleListing" SET "soldCount" = "soldCount" + ${quantity}
    WHERE "flashSaleId" = ${flashSaleId} AND "listingId" = ${listingId}
      AND ("quantityCap" IS NULL OR "soldCount" + ${quantity} <= "quantityCap")`;
  if (updated !== 1) throw new CheckoutError(`The sale price for ${label} just sold out. Review your cart and try again.`);
}

/** Give back sale units held by an unpaid order. */
export async function releaseFlashUnits(tx: Prisma.TransactionClient, orderId: string): Promise<void> {
  const items = await tx.orderItem.findMany({ where: { subOrder: { orderId } }, select: { listingId: true, quantity: true, variantSnapshot: true } });
  for (const item of items) {
    const snapshot = (item.variantSnapshot ?? {}) as Record<string, unknown>;
    if (typeof snapshot.flashSaleId !== "string") continue;
    await tx.$executeRaw`
      UPDATE "FlashSaleListing" SET "soldCount" = GREATEST("soldCount" - ${item.quantity}, 0)
      WHERE "flashSaleId" = ${snapshot.flashSaleId} AND "listingId" = ${item.listingId}`;
  }
}

export interface FlashSaleInput {
  name: string;
  discountBps: number;
  startsAt: Date;
  endsAt: Date;
  listings: Array<{ listingId: string; quantityCap: number | null }>;
}

export async function createFlashSale(sellerId: string, input: FlashSaleInput, now: Date): Promise<string> {
  const store = await prisma.store.findUnique({ where: { sellerId }, select: { id: true } });
  if (!store) throw new CheckoutError("Set up your store first.");
  const name = input.name.trim();
  if (name.length < 3 || name.length > 80) throw new CheckoutError("Name the sale (3–80 characters).");
  if (!Number.isInteger(input.discountBps) || input.discountBps < FLASH_LIMITS.minBps || input.discountBps > FLASH_LIMITS.maxBps) {
    throw new CheckoutError(`The discount must be between ${FLASH_LIMITS.minBps / 100}% and ${FLASH_LIMITS.maxBps / 100}%.`);
  }
  if (Number.isNaN(input.startsAt.getTime()) || Number.isNaN(input.endsAt.getTime())) throw new CheckoutError("Enter when the sale starts and ends.");
  if (input.endsAt <= input.startsAt) throw new CheckoutError("The sale must end after it starts.");
  if (input.endsAt <= now) throw new CheckoutError("The sale must end in the future.");
  if (input.endsAt.getTime() - input.startsAt.getTime() > FLASH_LIMITS.maxHours * 3_600_000) throw new CheckoutError("Flash sales can run for at most 14 days.");
  const unique = [...new Map(input.listings.map((line) => [line.listingId, line])).values()];
  if (unique.length === 0) throw new CheckoutError("Choose at least one listing.");
  if (unique.length > FLASH_LIMITS.maxListings) throw new CheckoutError(`A sale can include at most ${FLASH_LIMITS.maxListings} listings.`);
  for (const line of unique) {
    if (line.quantityCap !== null && (!Number.isInteger(line.quantityCap) || line.quantityCap < 1 || line.quantityCap > 100_000)) throw new CheckoutError("Sale quantities must be whole numbers of at least 1.");
  }
  const owned = await prisma.listing.count({ where: { id: { in: unique.map((line) => line.listingId) }, storeId: store.id, status: { in: ["ACTIVE", "PAUSED", "DRAFT", "PENDING_REVIEW"] } } });
  if (owned !== unique.length) throw new CheckoutError("Some of those listings are not in your store.");

  const sale = await prisma.flashSale.create({
    data: {
      storeId: store.id,
      name,
      discountBps: input.discountBps,
      startsAt: input.startsAt < now ? now : input.startsAt,
      endsAt: input.endsAt,
      listings: { create: unique.map((line) => ({ listingId: line.listingId, quantityCap: line.quantityCap })) },
    },
    select: { id: true },
  });
  return sale.id;
}

/** End a sale now (or cancel a scheduled one). Orders already placed keep their price. */
export async function endFlashSale(sellerId: string, flashSaleId: string, now: Date): Promise<void> {
  const updated = await prisma.flashSale.updateMany({
    where: { id: flashSaleId, store: { sellerId }, isActive: true },
    data: { isActive: false, endsAt: now },
  });
  if (updated.count === 0) throw new CheckoutError("That sale is already over.");
}
