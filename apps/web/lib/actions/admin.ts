"use server";

import { revalidatePath } from "next/cache";
import {
  CheckoutError,
  decideKyc,
  moderateListing,
  payAffiliate,
  reinstateUser,
  setFraudFlagStatus,
  setReviewStatus,
  setSetting,
  setUserRole,
  suspendUser,
} from "@marketplace/core";
import { prisma } from "@marketplace/database";
import { isUserRole, taxRatesSchema, type Permission } from "@marketplace/shared-types";
import { recordAudit } from "@/lib/audit";
import { authorize } from "@/lib/auth/session";
import { getClientIp } from "@/lib/request";
import { syncStoreStatus } from "@/lib/seller/status";
import { scheduleSearchSync } from "@/lib/search-sync";

export type AdminResult = { ok: true; message?: string } | { ok: false; message: string };

async function staff(permission: Permission) {
  const auth = await authorize(permission);
  return auth.ok ? auth.user : null;
}

async function run(work: () => Promise<void>, paths: string[], message?: string): Promise<AdminResult> {
  try {
    await work();
  } catch (error) {
    if (error instanceof CheckoutError) return { ok: false, message: error.message };
    throw error;
  }
  for (const path of paths) revalidatePath(path);
  return { ok: true, message };
}

const DENIED: AdminResult = { ok: false, message: "You do not have permission to do that." };

export async function decideKycAction(submissionId: string, approve: boolean, reason: string): Promise<AdminResult> {
  const user = await staff("kyc:review");
  if (!user) return DENIED;
  return run(
    async () => {
      const result = await decideKyc(user.id, submissionId, approve, reason, new Date());
      if (result.storeId) await syncStoreStatus(result.storeId);
      await recordAudit({ actorId: user.id, action: approve ? "kyc.approve" : "kyc.reject", entity: "KycSubmission", entityId: submissionId, data: approve ? {} : { reason: reason.slice(0, 300) }, ipAddress: await getClientIp() });
    },
    ["/admin/kyc", `/admin/kyc/${submissionId}`, "/admin"],
    approve ? "Approved. The store goes live once payouts are ready." : "Rejected. The seller has been told what to fix.",
  );
}

export async function moderateListingAction(listingId: string, decision: "approve" | "reject", note: string): Promise<AdminResult> {
  const user = await staff("listing:moderate");
  if (!user) return DENIED;
  return run(
    async () => {
      await moderateListing(user.id, listingId, decision, note, new Date());
      scheduleSearchSync({ kind: "listing", listingId });
      await recordAudit({ actorId: user.id, action: `listing.${decision}`, entity: "Listing", entityId: listingId, data: { note: note.slice(0, 300) }, ipAddress: await getClientIp() });
    },
    ["/admin/listings"],
    decision === "approve" ? "Listing published." : "Listing taken down.",
  );
}

export async function setReviewStatusAction(reviewId: string, status: "PUBLISHED" | "REJECTED"): Promise<AdminResult> {
  const user = await staff("review:moderate");
  if (!user) return DENIED;
  return run(
    async () => {
      await setReviewStatus(reviewId, status);
      const review = await prisma.review.findUnique({ where: { id: reviewId }, select: { listingId: true } });
      if (review) scheduleSearchSync({ kind: "listing", listingId: review.listingId });
      await recordAudit({ actorId: user.id, action: status === "REJECTED" ? "review.hide" : "review.restore", entity: "Review", entityId: reviewId, ipAddress: await getClientIp() });
    },
    ["/admin/reviews"],
  );
}

export async function setFraudFlagAction(flagId: string, status: "REVIEWING" | "CONFIRMED" | "DISMISSED"): Promise<AdminResult> {
  const user = await staff("fraud:review");
  if (!user) return DENIED;
  return run(
    async () => {
      await setFraudFlagStatus(flagId, status, new Date());
      await recordAudit({ actorId: user.id, action: `fraud.${status.toLowerCase()}`, entity: "FraudFlag", entityId: flagId, ipAddress: await getClientIp() });
    },
    ["/admin/fraud", "/admin"],
  );
}

export async function suspendUserAction(userId: string, reason: string): Promise<AdminResult> {
  const user = await staff("user:suspend");
  if (!user) return DENIED;
  return run(
    async () => {
      const result = await suspendUser(user.id, userId, reason);
      if (result.storeId) scheduleSearchSync({ kind: "store", storeId: result.storeId });
      await recordAudit({ actorId: user.id, action: "user.suspend", entity: "User", entityId: userId, data: { reason: reason.slice(0, 300) }, ipAddress: await getClientIp() });
    },
    [`/admin/users/${userId}`, "/admin/users", "/admin/fraud"],
    "Suspended and signed out everywhere.",
  );
}

export async function reinstateUserAction(userId: string): Promise<AdminResult> {
  const user = await staff("user:suspend");
  if (!user) return DENIED;
  return run(
    async () => {
      const result = await reinstateUser(userId);
      if (result.storeId) await syncStoreStatus(result.storeId);
      await recordAudit({ actorId: user.id, action: "user.reinstate", entity: "User", entityId: userId, ipAddress: await getClientIp() });
    },
    [`/admin/users/${userId}`, "/admin/users"],
    "Reinstated.",
  );
}

export async function setUserRoleAction(userId: string, role: string): Promise<AdminResult> {
  const user = await staff("role:assign");
  if (!user) return DENIED;
  if (!isUserRole(role)) return { ok: false, message: "Choose a role." };
  return run(
    async () => {
      await setUserRole(user.id, userId, role);
      await recordAudit({ actorId: user.id, action: "user.role", entity: "User", entityId: userId, data: { role }, ipAddress: await getClientIp() });
    },
    [`/admin/users/${userId}`],
    "Role updated. The user has been signed out so it takes effect.",
  );
}

export async function payAffiliateAction(affiliateId: string, currency: string, reference: string): Promise<AdminResult> {
  const user = await staff("ledger:reconcile");
  if (!user) return DENIED;
  return run(
    async () => {
      const total = await payAffiliate(user.id, affiliateId, currency, reference, new Date());
      await recordAudit({ actorId: user.id, action: "affiliate.payout", entity: "Affiliate", entityId: affiliateId, data: { currency, total, reference: reference.slice(0, 120) }, ipAddress: await getClientIp() });
    },
    ["/admin/ledger"],
    "Payout recorded.",
  );
}

export interface SettingsValues {
  feePercent: string;
  holdDays: string;
  reviewMode: string;
  taxRates: string;
}

export async function saveSettingsAction(values: SettingsValues): Promise<AdminResult> {
  const user = await staff("platform:configure");
  if (!user) return DENIED;
  const feeBps = Math.round(Number.parseFloat(values.feePercent.replace(",", ".")) * 100);
  if (!Number.isInteger(feeBps) || feeBps < 0 || feeBps > 5_000) return { ok: false, message: "The platform fee must be between 0% and 50%." };
  const holdDays = Number.parseInt(values.holdDays, 10);
  if (!Number.isInteger(holdDays) || holdDays < 0 || holdDays > 60) return { ok: false, message: "The protection window must be 0 to 60 days." };
  if (values.reviewMode !== "pre" && values.reviewMode !== "post") return { ok: false, message: "Choose when listings are reviewed." };
  let taxRates: unknown;
  try {
    taxRates = values.taxRates.trim() ? JSON.parse(values.taxRates) : {};
  } catch {
    return { ok: false, message: "The tax table is not valid JSON." };
  }
  const parsedTax = taxRatesSchema.safeParse(taxRates);
  if (!parsedTax.success) {
    const issue = parsedTax.error.issues[0];
    return { ok: false, message: `Tax table: ${issue?.path.join(".") ?? ""} ${issue?.message ?? "is invalid"}` };
  }
  const reviewMode = values.reviewMode;
  return run(
    async () => {
      await setSetting("platformFeeBps", feeBps);
      await setSetting("escrowHoldDays", holdDays);
      await setSetting("listingReviewMode", reviewMode);
      await setSetting("taxRates", parsedTax.data);
      await recordAudit({ actorId: user.id, action: "platform.settings", entity: "PlatformSetting", entityId: "all", data: { feeBps, holdDays, reviewMode, taxCountries: Object.keys(parsedTax.data) }, ipAddress: await getClientIp() });
    },
    ["/admin/settings"],
    "Saved. New orders use these settings; existing orders keep theirs.",
  );
}
