import { prisma, type Prisma } from "@marketplace/database";
import { shippingProfileSchema, type ShippingProfile } from "@marketplace/shared-types";
import { wholesaleUnitPrice } from "./pricing";

/** Everything checkout needs to know about a cart line's listing. */
export const purchasableInclude = {
  listing: {
    select: {
      id: true,
      slug: true,
      title: true,
      type: true,
      status: true,
      currency: true,
      images: true,
      storeId: true,
      store: {
        select: {
          id: true,
          name: true,
          slug: true,
          status: true,
          vacationMode: true,
          country: true,
          shippingProfile: true,
          commissionBpsOverride: true,
          warehouses: { where: { isDefault: true }, select: { country: true }, take: 1 },
        },
      },
      digitalAsset: { select: { id: true, price: true } },
    },
  },
  sku: {
    select: {
      id: true,
      listingId: true,
      isActive: true,
      price: true,
      variantValues: true,
      weightGrams: true,
      skuCode: true,
      wholesaleTiers: { select: { minQty: true, unitPrice: true } },
      inventory: { select: { id: true, onHand: true, reserved: true, warehouse: { select: { isDefault: true } } } },
    },
  },
  serviceTier: {
    select: { id: true, listingId: true, isActive: true, level: true, title: true, price: true, deliveryDays: true, revisions: true },
  },
} satisfies Prisma.CartItemInclude;

export type PurchasableLine = Prisma.CartItemGetPayload<{ include: typeof purchasableInclude }>;

export function parseShippingProfile(value: Prisma.JsonValue | null): ShippingProfile | null {
  if (value === null) return null;
  const parsed = shippingProfileSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export function availableStock(line: Pick<PurchasableLine, "sku">): number {
  if (!line.sku) return 0;
  return Math.max(0, line.sku.inventory.reduce((sum, level) => sum + level.onHand - level.reserved, 0));
}

export function variantLabel(line: Pick<PurchasableLine, "sku" | "serviceTier">): string | null {
  if (line.serviceTier) return `${line.serviceTier.title} package`;
  if (!line.sku) return null;
  const values = Object.values((line.sku.variantValues ?? {}) as Record<string, unknown>).filter((value): value is string => typeof value === "string");
  return values.length > 0 ? values.join(" / ") : null;
}

export type LineCheck = { ok: true; unitPrice: number; maxQuantity: number } | { ok: false; problem: string };

/** Can this cart line be bought right now, and at what unit price? */
export function checkLine(line: PurchasableLine, quantity: number): LineCheck {
  const { listing } = line;
  if (listing.status !== "ACTIVE" || listing.store.status !== "ACTIVE" || listing.store.vacationMode) {
    return { ok: false, problem: "No longer available." };
  }
  switch (listing.type) {
    case "PHYSICAL": {
      if (!line.sku || line.sku.listingId !== listing.id || !line.sku.isActive) return { ok: false, problem: "This variant is no longer sold." };
      const available = availableStock(line);
      if (available === 0) return { ok: false, problem: "Out of stock." };
      if (quantity > available) return { ok: false, problem: `Only ${available} left. Lower the quantity.` };
      return { ok: true, unitPrice: wholesaleUnitPrice(line.sku.price, quantity, line.sku.wholesaleTiers), maxQuantity: available };
    }
    case "DIGITAL": {
      if (!listing.digitalAsset) return { ok: false, problem: "This download is not available yet." };
      return { ok: true, unitPrice: listing.digitalAsset.price, maxQuantity: 1 };
    }
    case "SERVICE": {
      if (!line.serviceTier || line.serviceTier.listingId !== listing.id || !line.serviceTier.isActive) {
        return { ok: false, problem: "This package is no longer offered." };
      }
      return { ok: true, unitPrice: line.serviceTier.price, maxQuantity: 1 };
    }
  }
}
