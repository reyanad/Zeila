import { prisma } from "@marketplace/database";
import { promoCodeSchema } from "@marketplace/shared-types";
import { CheckoutError } from "./errors";

/** Store coupon codes, managed by the seller and applied by `resolvePromo` at checkout. */
export interface StorePromoInput {
  code: string;
  type: "PERCENT" | "FIXED";
  /** Basis points for PERCENT, minor units for FIXED. */
  value: number;
  minSubtotal: number;
  usageLimit: number | null;
  perUserLimit: number;
  startsAt: Date;
  expiresAt: Date | null;
}

export async function createStorePromo(sellerId: string, input: StorePromoInput, now: Date): Promise<string> {
  const store = await prisma.store.findUnique({ where: { sellerId }, select: { id: true, currency: true } });
  if (!store) throw new CheckoutError("Set up your store first.");
  const parsedCode = promoCodeSchema.safeParse(input.code);
  if (!parsedCode.success) throw new CheckoutError("Codes use 3–32 letters, numbers or dashes.");
  if (input.type === "PERCENT" && (!Number.isInteger(input.value) || input.value < 100 || input.value > 9_000)) throw new CheckoutError("Percentage codes take 1% to 90% off.");
  if (input.type === "FIXED" && (!Number.isInteger(input.value) || input.value < 1)) throw new CheckoutError("Enter how much the code takes off.");
  if (!Number.isInteger(input.minSubtotal) || input.minSubtotal < 0) throw new CheckoutError("The minimum order must be zero or more.");
  if (input.usageLimit !== null && (!Number.isInteger(input.usageLimit) || input.usageLimit < 1)) throw new CheckoutError("The usage limit must be at least 1, or empty for no limit.");
  if (!Number.isInteger(input.perUserLimit) || input.perUserLimit < 1 || input.perUserLimit > 100) throw new CheckoutError("Uses per buyer must be between 1 and 100.");
  if (input.expiresAt && input.expiresAt <= (input.startsAt > now ? input.startsAt : now)) throw new CheckoutError("The code must expire after it starts.");
  const taken = await prisma.promoCode.count({ where: { code: parsedCode.data } });
  if (taken > 0) throw new CheckoutError("That code is already in use. Choose another.");
  const promo = await prisma.promoCode.create({
    data: {
      code: parsedCode.data,
      storeId: store.id,
      type: input.type,
      value: input.value,
      // Fixed amounts and minimums are in the store's currency.
      currency: input.type === "FIXED" || input.minSubtotal > 0 ? store.currency : null,
      minSubtotal: input.minSubtotal,
      usageLimit: input.usageLimit,
      perUserLimit: input.perUserLimit,
      startsAt: input.startsAt,
      expiresAt: input.expiresAt,
    },
    select: { id: true },
  });
  return promo.id;
}

export async function setStorePromoActive(sellerId: string, promoCodeId: string, active: boolean): Promise<void> {
  const updated = await prisma.promoCode.updateMany({ where: { id: promoCodeId, store: { sellerId } }, data: { isActive: active } });
  if (updated.count === 0) throw new CheckoutError("That code does not exist.");
}
