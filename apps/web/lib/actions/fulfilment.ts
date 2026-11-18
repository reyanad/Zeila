"use server";

import { revalidatePath } from "next/cache";
import {
  addTrackingEvent,
  approveDelivery,
  cancelBySeller,
  CheckoutError,
  completeReturn,
  decideReturn,
  markPreparing,
  requestReturn,
  requestRevision,
  saveIntakeAnswers,
  shipSubOrder,
  startWork,
  submitDelivery,
  submitReturnTracking,
} from "@marketplace/core";
import { parseMoneyInput } from "@marketplace/shared-types";
import { recordAudit } from "@/lib/audit";
import { verifyAttachments } from "@/lib/attachments";
import { authorize } from "@/lib/auth/session";
import { formError, formSuccess, type FormState } from "@/lib/form-state";
import { getClientIp } from "@/lib/request";
import { getChapa } from "@/lib/chapa";

export type ActionResult = { ok: true; message?: string } | { ok: false; message: string };

async function attempt(work: () => Promise<void>, paths: string[], message?: string): Promise<ActionResult> {
  try {
    await work();
  } catch (error) {
    if (error instanceof CheckoutError) return { ok: false, message: error.message };
    throw error;
  }
  for (const path of paths) revalidatePath(path);
  return { ok: true, message };
}

function text(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value.trim() : "";
}

async function seller(): Promise<{ id: string } | null> {
  const auth = await authorize("order:fulfil");
  return auth.ok ? auth.user : null;
}

async function buyer(): Promise<{ id: string } | null> {
  const auth = await authorize("order:view-own");
  return auth.ok ? auth.user : null;
}

const SELLER_ORDER = (id: string) => [`/seller/studio/orders/${id}`, "/seller/studio/orders"];

// ---------------------------------------------------------------------------
// Seller: physical orders
// ---------------------------------------------------------------------------

export async function markPreparingAction(subOrderId: string): Promise<ActionResult> {
  const user = await seller();
  if (!user) return { ok: false, message: "Your session has expired." };
  return attempt(() => markPreparing(user.id, subOrderId), SELLER_ORDER(subOrderId));
}

export async function shipAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const user = await seller();
  if (!user) return formError("Your session has expired.");
  const subOrderId = text(formData, "subOrderId");
  const result = await attempt(
    () => shipSubOrder(user.id, subOrderId, { carrier: text(formData, "carrier"), trackingNumber: text(formData, "trackingNumber") || null, service: text(formData, "service") || null }, new Date()),
    SELLER_ORDER(subOrderId),
  );
  return result.ok ? formSuccess("Marked as shipped. The buyer can now follow the parcel.") : formError(result.message);
}

export async function trackingEventAction(subOrderId: string, shipmentId: string, status: "OUT_FOR_DELIVERY" | "DELIVERED" | "DELIVERY_FAILED"): Promise<ActionResult> {
  const user = await seller();
  if (!user) return { ok: false, message: "Your session has expired." };
  return attempt(() => addTrackingEvent(user.id, shipmentId, { status, location: null, note: null }, new Date()), SELLER_ORDER(subOrderId));
}

export async function cancelOrderAction(subOrderId: string, reason: string): Promise<ActionResult> {
  const user = await seller();
  if (!user) return { ok: false, message: "Your session has expired." };
  const result = await attempt(() => cancelBySeller(getChapa(), user.id, subOrderId, reason || "seller could not fulfil", new Date()), SELLER_ORDER(subOrderId));
  if (result.ok) await recordAudit({ actorId: user.id, action: "order.seller-cancel", entity: "SubOrder", entityId: subOrderId, data: { reason }, ipAddress: await getClientIp() });
  return result;
}

// ---------------------------------------------------------------------------
// Seller: returns
// ---------------------------------------------------------------------------

export async function decideReturnAction(subOrderId: string, rmaId: string, approve: boolean, note: string): Promise<ActionResult> {
  const user = await seller();
  if (!user) return { ok: false, message: "Your session has expired." };
  return attempt(() => decideReturn(user.id, rmaId, approve, note.slice(0, 1000), new Date()), SELLER_ORDER(subOrderId));
}

export async function completeReturnAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const user = await seller();
  if (!user) return formError("Your session has expired.");
  const subOrderId = text(formData, "subOrderId");
  const amount = parseMoneyInput(text(formData, "refund"));
  if (amount === null) return formError("Enter the refund amount, like 450 or 12.50.", { refund: "Enter an amount" });
  const result = await attempt(
    () => completeReturn(getChapa(), user.id, text(formData, "rmaId"), { refundAmount: amount, restock: formData.get("restock") === "on" }, new Date()),
    SELLER_ORDER(subOrderId),
  );
  if (result.ok) await recordAudit({ actorId: user.id, action: "return.refund", entity: "RmaRequest", entityId: text(formData, "rmaId"), data: { amount }, ipAddress: await getClientIp() });
  return result.ok ? formSuccess("Refunded. The buyer has been credited.") : formError(result.message);
}

// ---------------------------------------------------------------------------
// Seller: services
// ---------------------------------------------------------------------------

export async function startWorkAction(subOrderId: string, orderItemId: string): Promise<ActionResult> {
  const user = await seller();
  if (!user) return { ok: false, message: "Your session has expired." };
  return attempt(() => startWork(user.id, orderItemId, new Date()), SELLER_ORDER(subOrderId));
}

export async function submitDeliveryAction(subOrderId: string, orderItemId: string, message: string, fileTokens: string[]): Promise<ActionResult> {
  const user = await seller();
  if (!user) return { ok: false, message: "Your session has expired." };
  const files = verifyAttachments(orderItemId, fileTokens);
  if (!files) return { ok: false, message: "An attached file could not be verified. Upload it again." };
  return attempt(() => submitDelivery(user.id, orderItemId, { message, files }, new Date()), SELLER_ORDER(subOrderId), "Delivered. The buyer has been asked to review it.");
}

// ---------------------------------------------------------------------------
// Buyer
// ---------------------------------------------------------------------------

export async function requestReturnAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const user = await buyer();
  if (!user) return formError("Your session has expired.");
  const orderId = text(formData, "orderId");
  const quantity = Number.parseInt(text(formData, "quantity") || "1", 10);
  const result = await attempt(
    async () => {
      await requestReturn(user.id, text(formData, "orderItemId"), { reason: text(formData, "reason"), details: text(formData, "details"), quantity }, new Date());
    },
    [`/orders/${orderId}`],
  );
  return result.ok ? formSuccess("Return requested. The seller's payment is on hold until it is settled.") : formError(result.message);
}

export async function returnTrackingAction(orderId: string, rmaId: string, trackingNumber: string): Promise<ActionResult> {
  const user = await buyer();
  if (!user) return { ok: false, message: "Your session has expired." };
  if (trackingNumber.trim().length < 3) return { ok: false, message: "Enter the tracking number of your return parcel." };
  return attempt(() => submitReturnTracking(user.id, rmaId, trackingNumber.trim()), [`/orders/${orderId}`]);
}

export async function saveIntakeAction(orderId: string, orderItemId: string, answers: Record<string, string>, fileTokens: Record<string, string>): Promise<ActionResult> {
  const user = await buyer();
  if (!user) return { ok: false, message: "Your session has expired." };
  const files: Record<string, { key: string; fileName: string; sizeBytes: number }> = {};
  for (const [fieldId, token] of Object.entries(fileTokens)) {
    const verified = verifyAttachments(orderItemId, [token]);
    if (!verified?.[0]) return { ok: false, message: "An attached file could not be verified. Upload it again." };
    files[fieldId] = verified[0];
  }
  return attempt(() => saveIntakeAnswers(user.id, orderItemId, answers, files), [`/orders/${orderId}/work/${orderItemId}`], "Answers sent to the seller.");
}

export async function approveDeliveryAction(orderId: string, orderItemId: string): Promise<ActionResult> {
  const user = await buyer();
  if (!user) return { ok: false, message: "Your session has expired." };
  const result = await attempt(() => approveDelivery(user.id, orderItemId, new Date()), [`/orders/${orderId}/work/${orderItemId}`, `/orders/${orderId}`]);
  if (result.ok) await recordAudit({ actorId: user.id, action: "service.approve", entity: "OrderItem", entityId: orderItemId, ipAddress: await getClientIp() });
  return result;
}

export async function requestRevisionAction(orderId: string, orderItemId: string, note: string): Promise<ActionResult> {
  const user = await buyer();
  if (!user) return { ok: false, message: "Your session has expired." };
  return attempt(() => requestRevision(user.id, orderItemId, note, new Date()), [`/orders/${orderId}/work/${orderItemId}`], "Revision requested.");
}
