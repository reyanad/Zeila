import { describe, expect, it } from "vitest";
import { settleSubOrder } from "./fulfillment";
import { refundSplit } from "./refunds";

const subOrder = { storeId: "s", itemsSubtotal: 180_000, discountTotal: 18_000, shippingTotal: 14_000, taxTotal: 26_400, grandTotal: 202_400, platformFee: 9_000 };

describe.each(["platform", "store"] as const)("refund split with a %s-funded promo", (fundedBy) => {
  const settlement = settleSubOrder(subOrder, fundedBy);

  it("unwinds the payment exactly on a full refund", () => {
    const split = refundSplit(subOrder.grandTotal, settlement.fee, settlement.platformDiscount, subOrder.grandTotal);
    expect(split).toEqual({ escrowPart: settlement.escrowAmount, feePart: settlement.fee, promoPart: settlement.platformDiscount });
  });

  it("balances every partial refund and never takes more than escrow holds", () => {
    let escrow = 0;
    for (const amount of [33_333, 70_001, 99_066]) {
      const split = refundSplit(subOrder.grandTotal, settlement.fee, settlement.platformDiscount, amount);
      expect(split.escrowPart + split.feePart).toBe(amount + split.promoPart);
      escrow += split.escrowPart;
    }
    expect(escrow).toBeLessThanOrEqual(settlement.escrowAmount);
  });
});

describe("settleSubOrder", () => {
  it("pays the store as if a platform promo had not happened", () => {
    expect(settleSubOrder(subOrder, "platform")).toEqual({ entitlement: 220_400, fee: 9_000, platformDiscount: 18_000, escrowAmount: 211_400 });
  });
  it("leaves store-funded discounts with the store", () => {
    expect(settleSubOrder(subOrder, "store")).toEqual({ entitlement: 202_400, fee: 9_000, platformDiscount: 0, escrowAmount: 193_400 });
  });
});
