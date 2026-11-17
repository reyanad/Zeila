"use server";

import { revalidatePath } from "next/cache";
import {
  CheckoutError,
  createFlashSale,
  createStorePromo,
  endFlashSale,
  joinAffiliateProgram,
  replyToReview,
  setStorePromoActive,
  submitReview,
} from "@marketplace/core";
import { parseMoneyInput } from "@marketplace/shared-types";
import { recordAudit } from "@/lib/audit";
import { authorize } from "@/lib/auth/session";
import { getClientIp } from "@/lib/request";
import { scheduleSearchSync } from "@/lib/search-sync";

export type GrowthResult = { ok: true; message?: string; data?: string } | { ok: false; message: string };

async function attempt(work: () => Promise<string | void>, paths: string[], message?: string): Promise<GrowthResult> {
  let data: string | void;
  try {
    data = await work();
  } catch (error) {
    if (error instanceof CheckoutError) return { ok: false, message: error.message };
    throw error;
  }
  for (const path of paths) revalidatePath(path);
  return { ok: true, message, data: typeof data === "string" ? data : undefined };
}

function percentToBps(value: string): number | null {
  const parsed = Number.parseFloat(value.replace(",", "."));
  return Number.isFinite(parsed) ? Math.round(parsed * 100) : null;
}

// ---------------------------------------------------------------------------
// Flash sales and coupons (sellers)
// ---------------------------------------------------------------------------

export interface FlashSaleFormValues {
  name: string;
  percent: string;
  startsAt: string; // ISO, converted from the seller's local time in the browser
  endsAt: string;
  listings: Array<{ listingId: string; cap: string }>;
}

export async function createFlashSaleAction(values: FlashSaleFormValues): Promise<GrowthResult> {
  const auth = await authorize("listing:manage");
  if (!auth.ok) return { ok: false, message: auth.message };
  const discountBps = percentToBps(values.percent);
  if (discountBps === null) return { ok: false, message: "Enter the discount, like 20 for 20% off." };
  const listings: Array<{ listingId: string; quantityCap: number | null }> = [];
  for (const line of values.listings) {
    const cap = line.cap.trim() ? Number.parseInt(line.cap, 10) : null;
    if (cap !== null && !Number.isFinite(cap)) return { ok: false, message: "Sale quantities must be whole numbers." };
    listings.push({ listingId: line.listingId, quantityCap: cap });
  }
  const result = await attempt(
    () => createFlashSale(auth.user.id, { name: values.name, discountBps, startsAt: new Date(values.startsAt), endsAt: new Date(values.endsAt), listings }, new Date()),
    ["/seller/studio/promotions", "/deals"],
    "Flash sale scheduled.",
  );
  if (result.ok) {
    for (const line of listings) scheduleSearchSync({ kind: "listing", listingId: line.listingId });
    await recordAudit({ actorId: auth.user.id, action: "flash-sale.create", entity: "FlashSale", entityId: result.data ?? "unknown", data: { discountBps, listings: listings.length }, ipAddress: await getClientIp() });
  }
  return result;
}

export async function endFlashSaleAction(flashSaleId: string): Promise<GrowthResult> {
  const auth = await authorize("listing:manage");
  if (!auth.ok) return { ok: false, message: auth.message };
  return attempt(() => endFlashSale(auth.user.id, flashSaleId, new Date()), ["/seller/studio/promotions", "/deals"], "Sale ended.");
}

export interface PromoFormValues {
  code: string;
  type: "PERCENT" | "FIXED";
  value: string;
  minSubtotal: string;
  usageLimit: string;
  perUserLimit: string;
  startsAt: string;
  expiresAt: string;
}

export async function createPromoAction(values: PromoFormValues): Promise<GrowthResult> {
  const auth = await authorize("listing:manage");
  if (!auth.ok) return { ok: false, message: auth.message };
  const value = values.type === "PERCENT" ? percentToBps(values.value) : parseMoneyInput(values.value);
  if (value === null) return { ok: false, message: values.type === "PERCENT" ? "Enter the percentage, like 10." : "Enter the amount, like 200 or 9.99." };
  const minSubtotal = values.minSubtotal.trim() ? parseMoneyInput(values.minSubtotal) : 0;
  if (minSubtotal === null) return { ok: false, message: "Enter the minimum order amount, or leave it empty." };
  const usageLimit = values.usageLimit.trim() ? Number.parseInt(values.usageLimit, 10) : null;
  const perUserLimit = values.perUserLimit.trim() ? Number.parseInt(values.perUserLimit, 10) : 1;
  return attempt(
    () =>
      createStorePromo(
        auth.user.id,
        {
          code: values.code,
          type: values.type,
          value,
          minSubtotal,
          usageLimit: usageLimit !== null && Number.isFinite(usageLimit) ? usageLimit : null,
          perUserLimit: Number.isFinite(perUserLimit) ? perUserLimit : 1,
          startsAt: values.startsAt ? new Date(values.startsAt) : new Date(),
          expiresAt: values.expiresAt ? new Date(values.expiresAt) : null,
        },
        new Date(),
      ),
    ["/seller/studio/promotions"],
    "Code created.",
  );
}

export async function setPromoActiveAction(promoCodeId: string, active: boolean): Promise<GrowthResult> {
  const auth = await authorize("listing:manage");
  if (!auth.ok) return { ok: false, message: auth.message };
  return attempt(() => setStorePromoActive(auth.user.id, promoCodeId, active), ["/seller/studio/promotions"]);
}

// ---------------------------------------------------------------------------
// Affiliates and reviews
// ---------------------------------------------------------------------------

export async function joinAffiliateAction(): Promise<GrowthResult> {
  const auth = await authorize();
  if (!auth.ok) return { ok: false, message: auth.message };
  return attempt(() => joinAffiliateProgram(auth.user.id), ["/affiliates"], "Your referral link is ready.");
}

export async function submitReviewAction(orderId: string, orderItemId: string, values: { rating: number; title: string; body: string }): Promise<GrowthResult> {
  const auth = await authorize("review:create");
  if (!auth.ok) return { ok: false, message: auth.message };
  let listingId = "";
  const result = await attempt(
    async () => {
      listingId = (await submitReview(auth.user.id, orderItemId, values, new Date())).listingId;
    },
    [`/orders/${orderId}`],
    "Thanks for your review.",
  );
  if (result.ok && listingId) scheduleSearchSync({ kind: "listing", listingId });
  return result;
}

export async function replyToReviewAction(reviewId: string, reply: string): Promise<GrowthResult> {
  const auth = await authorize("listing:manage");
  if (!auth.ok) return { ok: false, message: auth.message };
  return attempt(() => replyToReview(auth.user.id, reviewId, reply, new Date()), ["/seller/studio/reviews"], "Reply posted.");
}
