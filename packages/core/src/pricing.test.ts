import { describe, expect, it } from "vitest";
import type { ShippingProfile } from "@marketplace/shared-types";
import { allocate, priceCheckout, shippingCost, wholesaleUnitPrice, type PricingLine } from "./pricing";

const profile: ShippingProfile = { domestic: { base: 500, perKg: 200 }, international: null, freeOverDomestic: 20_000, handlingDays: 2 };
const line = (overrides: Partial<PricingLine>): PricingLine => ({ key: "a", storeId: "s1", type: "PHYSICAL", quantity: 1, unitPrice: 1_000, weightGrams: 500, ...overrides });

describe("allocate", () => {
  it("splits exactly, largest remainder first", () => {
    expect(allocate(100, [1, 1, 1])).toEqual([34, 33, 33]);
    expect(allocate(7, [5, 3])).toEqual([4, 3]);
    expect(allocate(0, [5, 3])).toEqual([0, 0]);
    expect(allocate(10, [0, 0])).toEqual([0, 0]);
  });
  it("always sums to the amount", () => {
    for (const amount of [1, 99, 1_001, 123_457]) {
      const parts = allocate(amount, [3, 7, 11, 13]);
      expect(parts.reduce((sum, part) => sum + part, 0)).toBe(amount);
    }
  });
});

describe("shippingCost", () => {
  it("charges base plus per started kilogram after the first", () => {
    expect(shippingCost(profile, "ET", "ET", 500, 1_000)).toEqual({ cost: 500 });
    expect(shippingCost(profile, "ET", "ET", 2_100, 1_000)).toEqual({ cost: 900 });
  });
  it("is free over the domestic threshold", () => {
    expect(shippingCost(profile, "ET", "ET", 5_000, 20_000)).toEqual({ cost: 0 });
  });
  it("refuses countries the seller does not ship to", () => {
    expect(shippingCost(profile, "ET", "KE", 500, 1_000)).toHaveProperty("problem");
  });
});

describe("wholesaleUnitPrice", () => {
  it("uses the best tier reached", () => {
    const tiers = [
      { minQty: 10, unitPrice: 900 },
      { minQty: 50, unitPrice: 800 },
    ];
    expect(wholesaleUnitPrice(1_000, 9, tiers)).toBe(1_000);
    expect(wholesaleUnitPrice(1_000, 10, tiers)).toBe(900);
    expect(wholesaleUnitPrice(1_000, 75, tiers)).toBe(800);
  });
});

describe("priceCheckout", () => {
  const base = { stores: { s1: { originCountry: "ET", profile }, s2: { originCountry: "ET", profile } }, destinationCountry: "ET", taxCountry: "ET", promo: null, taxRates: {} };

  it("totals items and shipping per store", () => {
    const result = priceCheckout({ ...base, lines: [line({ key: "a", quantity: 2 }), line({ key: "b", storeId: "s2" })] });
    expect(result.itemsSubtotal).toBe(3_000);
    expect(result.shippingTotal).toBe(500 + 500);
    expect(result.grandTotal).toBe(4_000);
    expect(result.stores.map((store) => store.problem)).toEqual([null, null]);
  });

  it("needs an address for physical items but not for downloads", () => {
    const result = priceCheckout({ ...base, destinationCountry: null, lines: [line({ key: "a" }), line({ key: "d", storeId: "s2", type: "DIGITAL", weightGrams: null })] });
    expect(result.stores[0]?.problem).toBe("Add a delivery address.");
    expect(result.stores[1]?.problem).toBeNull();
  });

  it("allocates a platform percentage promo across stores", () => {
    const result = priceCheckout({ ...base, promo: { code: "TEN", storeId: null, type: "PERCENT", value: 1_000, minSubtotal: 0 }, lines: [line({ key: "a", unitPrice: 3_000 }), line({ key: "b", storeId: "s2", unitPrice: 1_000 })] });
    expect(result.discountTotal).toBe(400);
    expect(result.stores.map((store) => store.discount)).toEqual([300, 100]);
    expect(result.promoProblem).toBeNull();
  });

  it("applies a store code only to that store and caps fixed amounts", () => {
    const result = priceCheckout({ ...base, promo: { code: "S2", storeId: "s2", type: "FIXED", value: 5_000, minSubtotal: 0 }, lines: [line({ key: "a" }), line({ key: "b", storeId: "s2", unitPrice: 1_200 })] });
    expect(result.stores.map((store) => store.discount)).toEqual([0, 1_200]);
  });

  it("explains a promo below its minimum spend", () => {
    const result = priceCheckout({ ...base, promo: { code: "BIG", storeId: null, type: "PERCENT", value: 1_000, minSubtotal: 50_000 }, lines: [line({})] });
    expect(result.discountTotal).toBe(0);
    expect(result.promoProblem).toMatch(/minimum/);
  });

  it("taxes by destination for goods (with shipping) and by buyer country for services", () => {
    const taxRates = { ET: { bps: 1_500, physical: true, digital: true, service: true, shippingTaxable: true, label: "VAT" } };
    const result = priceCheckout({ ...base, taxRates, lines: [line({ key: "a", unitPrice: 10_000 }), line({ key: "s", storeId: "s2", type: "SERVICE", unitPrice: 2_000, weightGrams: null })] });
    // (10,000 + 500 shipping) × 15% and 2,000 × 15%
    expect(result.stores.map((store) => store.tax)).toEqual([1_575, 300]);
    expect(result.taxLabel).toBe("VAT");
  });
});
