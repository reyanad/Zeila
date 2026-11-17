import { prisma } from "@marketplace/database";
import type { PromoRule } from "./pricing";

export type PromoLookup = { ok: true; rule: PromoRule; promoCodeId: string } | { ok: false; problem: string };

/** Validate a promo code for a cart in `currency`, for `buyerId` when known. */
export async function resolvePromo(code: string, currency: string, buyerId: string | null, now: Date): Promise<PromoLookup> {
  const promo = await prisma.promoCode.findUnique({
    where: { code },
    include: { store: { select: { status: true } }, _count: { select: { redemptions: true } } },
  });
  if (!promo || !promo.isActive) return { ok: false, problem: "That code is not valid." };
  if (promo.startsAt > now) return { ok: false, problem: "That code is not active yet." };
  if (promo.expiresAt && promo.expiresAt <= now) return { ok: false, problem: "That code has expired." };
  if (promo.store && promo.store.status !== "ACTIVE") return { ok: false, problem: "That code is not valid." };
  if (promo.type === "FIXED" && promo.currency !== currency) {
    return { ok: false, problem: `That code only works for ${promo.currency ?? "another currency"} carts.` };
  }
  if (promo.usageLimit !== null && promo._count.redemptions >= promo.usageLimit) {
    return { ok: false, problem: "That code has been used up." };
  }
  if (buyerId) {
    const used = await prisma.promoRedemption.count({ where: { promoCodeId: promo.id, userId: buyerId } });
    if (used >= promo.perUserLimit) return { ok: false, problem: "You have already used this code." };
  }
  // Minimum spend is expressed in the code's currency; for a currency-free percentage code it applies as-is.
  const minSubtotal = promo.currency === null || promo.currency === currency ? promo.minSubtotal : 0;
  return {
    ok: true,
    promoCodeId: promo.id,
    rule: { code: promo.code, storeId: promo.storeId, type: promo.type, value: promo.value, minSubtotal },
  };
}
