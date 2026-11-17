import { describe, expect, it } from "vitest";
import { referralCommission } from "./affiliates";
import { applyFlash, type FlashDeal } from "./flash-sales";
import { generateLicenseKey } from "./fulfillment";
import { accounts, checkBalanced, UnbalancedEntryError } from "./ledger";

describe("referralCommission", () => {
  it("is a share of the platform fee, net of refunds", () => {
    expect(referralCommission([{ platformFee: 5_000, grandTotal: 100_000, refundedTotal: 0, status: "COMPLETED" }], 2_000)).toBe(1_000);
    expect(referralCommission([{ platformFee: 5_000, grandTotal: 100_000, refundedTotal: 50_000, status: "COMPLETED" }], 2_000)).toBe(500);
    expect(referralCommission([{ platformFee: 5_000, grandTotal: 100_000, refundedTotal: 100_000, status: "REFUNDED" }], 2_000)).toBe(0);
    expect(referralCommission([{ platformFee: 5_000, grandTotal: 100_000, refundedTotal: 0, status: "CANCELLED" }, { platformFee: 1_000, grandTotal: 20_000, refundedTotal: 0, status: "COMPLETED" }], 2_000)).toBe(200);
  });
});

describe("applyFlash", () => {
  const deal: FlashDeal = { flashSaleId: "f", name: "Sale", discountBps: 2_000, endsAt: new Date(), remaining: 3 };
  it("discounts within the cap and charges the normal price beyond it", () => {
    expect(applyFlash(10_000, 3, deal)).toEqual({ unitPrice: 8_000, deal });
    expect(applyFlash(10_000, 4, deal)).toEqual({ unitPrice: 10_000, deal: null });
    expect(applyFlash(999, 50, { ...deal, remaining: null }).unitPrice).toBe(799);
    expect(applyFlash(999, 1, undefined)).toEqual({ unitPrice: 999, deal: null });
  });
});

describe("generateLicenseKey", () => {
  it("fills blocks from an unambiguous alphabet", () => {
    const key = generateLicenseKey("APP-{{BLOCK4}}-{{BLOCK4}}-{{BLOCK5}}");
    expect(key).toMatch(/^APP-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{5}$/);
    expect(generateLicenseKey("{{BLOCK8}}")).not.toBe(generateLicenseKey("{{BLOCK8}}"));
  });
});

describe("checkBalanced", () => {
  const cash = accounts.cash("ETB");
  const fees = accounts.fees("ETB");
  it("accepts balanced entries and drops zero lines", () => {
    const lines = checkBalanced({ idempotencyKey: "k", description: "d", occurredAt: new Date(), lines: [
      { account: cash, direction: "DEBIT", amount: 100 },
      { account: fees, direction: "CREDIT", amount: 100 },
      { account: fees, direction: "CREDIT", amount: 0 },
    ] });
    expect(lines).toHaveLength(2);
  });
  it("rejects unbalanced, negative, fractional and single-line entries", () => {
    const entry = (lines: Array<{ amount: number; direction: "DEBIT" | "CREDIT" }>) => () =>
      checkBalanced({ idempotencyKey: "k", description: "d", occurredAt: new Date(), lines: lines.map((line, index) => ({ ...line, account: index % 2 === 0 ? cash : fees })) });
    expect(entry([{ amount: 100, direction: "DEBIT" }, { amount: 99, direction: "CREDIT" }])).toThrow(UnbalancedEntryError);
    expect(entry([{ amount: -1, direction: "DEBIT" }, { amount: -1, direction: "CREDIT" }])).toThrow(UnbalancedEntryError);
    expect(entry([{ amount: 1.5, direction: "DEBIT" }, { amount: 1.5, direction: "CREDIT" }])).toThrow(UnbalancedEntryError);
    expect(entry([{ amount: 100, direction: "DEBIT" }])).toThrow(UnbalancedEntryError);
  });
  it("balances per currency", () => {
    expect(() =>
      checkBalanced({ idempotencyKey: "k", description: "d", occurredAt: new Date(), lines: [
        { account: accounts.cash("ETB"), direction: "DEBIT", amount: 100 },
        { account: accounts.fees("USD"), direction: "CREDIT", amount: 100 },
      ] }),
    ).toThrow(UnbalancedEntryError);
  });
});
