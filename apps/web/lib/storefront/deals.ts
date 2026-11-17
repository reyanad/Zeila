import "server-only";
import { activeFlashDeals, type FlashDeal } from "@marketplace/core";
import { discountedUnitPrice } from "@marketplace/shared-types";
import type { PurchaseData } from "@/components/storefront/purchase-panel";

export interface DealView {
  name: string;
  discountBps: number;
  endsAt: string;
  remaining: number | null;
}

export function dealView(deal: FlashDeal): DealView {
  return { name: deal.name, discountBps: deal.discountBps, endsAt: deal.endsAt.toISOString(), remaining: deal.remaining };
}

export async function dealsFor(listingIds: readonly string[]): Promise<Record<string, DealView>> {
  const deals = await activeFlashDeals(listingIds, new Date());
  return Object.fromEntries([...deals.entries()].map(([listingId, deal]) => [listingId, dealView(deal)]));
}

/** Show sale prices in the purchase panel (checkout applies the same discount). */
export function withDeal(data: PurchaseData, deal: DealView | undefined): PurchaseData {
  if (!deal) return data;
  const off = (price: number) => discountedUnitPrice(price, deal.discountBps);
  switch (data.type) {
    case "PHYSICAL":
      return {
        ...data,
        skus: data.skus.map((sku) => ({
          ...sku,
          price: off(sku.price),
          compareAtPrice: Math.max(sku.compareAtPrice ?? 0, sku.price),
          wholesale: sku.wholesale.map((tier) => ({ ...tier, unitPrice: off(tier.unitPrice) })),
        })),
      };
    case "DIGITAL":
      return { ...data, price: off(data.price) };
    case "SERVICE":
      return { ...data, tiers: data.tiers.map((tier) => ({ ...tier, price: off(tier.price) })) };
  }
}
