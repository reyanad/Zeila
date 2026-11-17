/**
 * Checkout pricing engine. Pure functions: no database, no clock, so every
 * rule is unit-testable and the server and a preview always agree.
 *
 * Order of operations per store (each store becomes its own sub-order):
 *   1. line totals (unit price already includes any wholesale discount)
 *   2. promo discount, allocated across eligible lines so cents always add up
 *   3. shipping from the store's profile, by weight and destination
 *   4. tax for the destination country on discounted lines (+ shipping if taxable)
 */
import {
  DEFAULT_ITEM_WEIGHT_GRAMS,
  type ListingTypeValue,
  type ShippingProfile,
  type TaxRates,
} from "@marketplace/shared-types";

export interface PricingLine {
  key: string;
  storeId: string;
  type: ListingTypeValue;
  quantity: number;
  /** Per unit, after wholesale tiers. */
  unitPrice: number;
  /** Per unit, physical items only (null = default weight). */
  weightGrams: number | null;
}

export interface StoreShippingContext {
  originCountry: string | null;
  profile: ShippingProfile | null;
}

export interface PromoRule {
  code: string;
  storeId: string | null;
  type: "PERCENT" | "FIXED";
  /** Basis points for PERCENT, minor units for FIXED. */
  value: number;
  minSubtotal: number;
}

export interface PricingInput {
  lines: PricingLine[];
  stores: Record<string, StoreShippingContext>;
  /** Delivery country for physical items. */
  destinationCountry: string | null;
  /** Country used for tax on digital goods and services (buyer's country). */
  taxCountry: string | null;
  promo: PromoRule | null;
  taxRates: TaxRates;
}

export interface PricedLine {
  key: string;
  lineTotal: number;
  discount: number;
}

export interface PricedStore {
  storeId: string;
  lines: PricedLine[];
  itemsSubtotal: number;
  discount: number;
  shipping: number;
  tax: number;
  total: number;
  /** Why this store's items cannot be checked out (shipping not possible). */
  problem: string | null;
}

export interface PricingResult {
  stores: PricedStore[];
  itemsSubtotal: number;
  discountTotal: number;
  shippingTotal: number;
  taxTotal: number;
  grandTotal: number;
  taxLabel: string | null;
  /** The promo did not apply; the reason is shown next to the code. */
  promoProblem: string | null;
}

/**
 * Split `amount` across `weights` in proportion, with the largest-remainder
 * method so the parts always sum to exactly `amount`.
 */
export function allocate(amount: number, weights: readonly number[]): number[] {
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  if (amount === 0 || total === 0) return weights.map(() => 0);
  const raw = weights.map((weight) => (amount * weight) / total);
  const parts = raw.map((value) => Math.floor(value));
  let remainder = amount - parts.reduce((sum, value) => sum + value, 0);
  const order = raw.map((value, index) => ({ index, fraction: value - Math.floor(value) })).sort((a, b) => b.fraction - a.fraction);
  for (const { index } of order) {
    if (remainder <= 0) break;
    parts[index] = (parts[index] ?? 0) + 1;
    remainder -= 1;
  }
  return parts;
}

export function shippingCost(
  profile: ShippingProfile,
  originCountry: string | null,
  destinationCountry: string,
  weightGrams: number,
  subtotalAfterDiscount: number,
): { cost: number } | { problem: string } {
  const domestic = originCountry === null || originCountry === destinationCountry;
  const rate = domestic ? profile.domestic : profile.international;
  if (!rate) return { problem: "This seller does not ship to your country." };
  if (domestic && profile.freeOverDomestic !== null && subtotalAfterDiscount >= profile.freeOverDomestic) return { cost: 0 };
  const kilograms = Math.max(1, Math.ceil(weightGrams / 1000));
  return { cost: rate.base + rate.perKg * (kilograms - 1) };
}

function taxApplies(rule: { physical: boolean; digital: boolean; service: boolean }, type: ListingTypeValue): boolean {
  return type === "PHYSICAL" ? rule.physical : type === "DIGITAL" ? rule.digital : rule.service;
}

export function priceCheckout(input: PricingInput): PricingResult {
  const storeIds = [...new Set(input.lines.map((line) => line.storeId))];
  const lineTotals = new Map(input.lines.map((line) => [line.key, line.unitPrice * line.quantity]));

  // Promo: eligible lines are the promo store's lines, or every line for a platform code.
  const discounts = new Map<string, number>();
  let promoProblem: string | null = null;
  if (input.promo) {
    const promo = input.promo;
    const eligible = input.lines.filter((line) => promo.storeId === null || line.storeId === promo.storeId);
    const eligibleTotal = eligible.reduce((sum, line) => sum + (lineTotals.get(line.key) ?? 0), 0);
    if (eligible.length === 0) {
      promoProblem = "This code does not apply to anything in your cart.";
    } else if (eligibleTotal < promo.minSubtotal) {
      promoProblem = "Your cart does not reach the minimum spend for this code.";
    } else {
      const amount = promo.type === "PERCENT" ? Math.round((eligibleTotal * promo.value) / 10_000) : Math.min(promo.value, eligibleTotal);
      const parts = allocate(amount, eligible.map((line) => lineTotals.get(line.key) ?? 0));
      eligible.forEach((line, index) => discounts.set(line.key, parts[index] ?? 0));
    }
  }

  const physicalTaxRule = input.destinationCountry ? input.taxRates[input.destinationCountry] : undefined;
  const otherTaxRule = input.taxCountry ? input.taxRates[input.taxCountry] : undefined;

  const stores: PricedStore[] = storeIds.map((storeId) => {
    const lines = input.lines.filter((line) => line.storeId === storeId);
    const priced = lines.map((line) => ({ key: line.key, lineTotal: lineTotals.get(line.key) ?? 0, discount: discounts.get(line.key) ?? 0 }));
    const itemsSubtotal = priced.reduce((sum, line) => sum + line.lineTotal, 0);
    const discount = priced.reduce((sum, line) => sum + line.discount, 0);

    let shipping = 0;
    let problem: string | null = null;
    const physical = lines.filter((line) => line.type === "PHYSICAL");
    if (physical.length > 0) {
      const context = input.stores[storeId];
      if (!input.destinationCountry) problem = "Add a delivery address.";
      else if (!context?.profile) problem = "This seller has not set up shipping yet.";
      else {
        const weight = physical.reduce((sum, line) => sum + (line.weightGrams ?? DEFAULT_ITEM_WEIGHT_GRAMS) * line.quantity, 0);
        const physicalAfterDiscount = physical.reduce((sum, line) => sum + (lineTotals.get(line.key) ?? 0) - (discounts.get(line.key) ?? 0), 0);
        const result = shippingCost(context.profile, context.originCountry, input.destinationCountry, weight, physicalAfterDiscount);
        if ("problem" in result) problem = result.problem;
        else shipping = result.cost;
      }
    }

    // Tax base per applicable rule (physical goods follow the delivery country).
    let physicalBase = 0;
    let otherBase = 0;
    for (const line of lines) {
      const taxable = (lineTotals.get(line.key) ?? 0) - (discounts.get(line.key) ?? 0);
      if (line.type === "PHYSICAL") {
        if (physicalTaxRule && taxApplies(physicalTaxRule, "PHYSICAL")) physicalBase += taxable;
      } else if (otherTaxRule && taxApplies(otherTaxRule, line.type)) {
        otherBase += taxable;
      }
    }
    if (physicalTaxRule?.shippingTaxable && physical.length > 0) physicalBase += shipping;
    const tax =
      (physicalTaxRule ? Math.round((physicalBase * physicalTaxRule.bps) / 10_000) : 0) +
      (otherTaxRule ? Math.round((otherBase * otherTaxRule.bps) / 10_000) : 0);

    return { storeId, lines: priced, itemsSubtotal, discount, shipping, tax, total: itemsSubtotal - discount + shipping + tax, problem };
  });

  const sum = (pick: (store: PricedStore) => number) => stores.reduce((total, store) => total + pick(store), 0);
  return {
    stores,
    itemsSubtotal: sum((store) => store.itemsSubtotal),
    discountTotal: sum((store) => store.discount),
    shippingTotal: sum((store) => store.shipping),
    taxTotal: sum((store) => store.tax),
    grandTotal: sum((store) => store.total),
    taxLabel: physicalTaxRule?.label ?? otherTaxRule?.label ?? null,
    promoProblem,
  };
}

/** Unit price after the best wholesale tier for the quantity. */
export function wholesaleUnitPrice(basePrice: number, quantity: number, tiers: ReadonlyArray<{ minQty: number; unitPrice: number }>): number {
  let price = basePrice;
  let bestMin = 0;
  for (const tier of tiers) {
    if (quantity >= tier.minQty && tier.minQty > bestMin) {
      price = tier.unitPrice;
      bestMin = tier.minQty;
    }
  }
  return price;
}
