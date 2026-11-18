"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import {
  acceptDisputeProposal,
  CheckoutError,
  escalateDispute,
  openDispute,
  postDisputeMessage,
  resolveDispute,
  withdrawDispute,
} from "@marketplace/core";
import { prisma } from "@marketplace/database";
import { isStaff, parseMoneyInput } from "@marketplace/shared-types";
import { recordAudit } from "@/lib/audit";
import { authorize, getCurrentUser } from "@/lib/auth/session";
import { verifyDisputeFiles } from "@/lib/dispute-files";
import { getClientIp } from "@/lib/request";
import { getChapa } from "@/lib/chapa";

export type DisputeActionResult = { ok: true; message?: string } | { ok: false; message: string };

async function attempt(work: () => Promise<void>, paths: string[], message?: string): Promise<DisputeActionResult> {
  try {
    await work();
  } catch (error) {
    if (error instanceof CheckoutError) return { ok: false, message: error.message };
    throw error;
  }
  for (const path of paths) revalidatePath(path);
  return { ok: true, message };
}

export interface OpenDisputeValues {
  subOrderId: string;
  orderItemId: string;
  reason: string;
  description: string;
  fileTokens: string[];
}

export async function openDisputeAction(values: OpenDisputeValues): Promise<DisputeActionResult> {
  const auth = await authorize("dispute:open");
  if (!auth.ok) return { ok: false, message: auth.message };
  const files = verifyDisputeFiles(values.subOrderId, values.fileTokens);
  if (!files) return { ok: false, message: "An attached file could not be verified. Upload it again." };
  let disputeId = "";
  const result = await attempt(async () => {
    disputeId = await openDispute(
      auth.user.id,
      { subOrderId: values.subOrderId, orderItemId: values.orderItemId || null, reason: values.reason, description: values.description, attachments: files },
      new Date(),
    );
  }, ["/disputes"]);
  if (!result.ok) return result;
  await recordAudit({ actorId: auth.user.id, action: "dispute.open", entity: "Dispute", entityId: disputeId, data: { reason: values.reason }, ipAddress: await getClientIp() });
  redirect(`/disputes/${disputeId}`);
}

export interface DisputeReplyValues {
  body: string;
  fileTokens: string[];
  proposal: string;
}

export async function replyToDisputeAction(disputeId: string, values: DisputeReplyValues): Promise<DisputeActionResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, message: "Your session has expired." };
  const dispute = await prisma.dispute.findUnique({ where: { id: disputeId }, select: { subOrderId: true } });
  if (!dispute) return { ok: false, message: "That case does not exist." };
  const files = verifyDisputeFiles(dispute.subOrderId, values.fileTokens);
  if (!files) return { ok: false, message: "An attached file could not be verified. Upload it again." };
  let proposal: number | null = null;
  if (values.proposal.trim()) {
    proposal = parseMoneyInput(values.proposal);
    if (proposal === null) return { ok: false, message: "Enter the refund you offer, like 450 or 12.50." };
  }
  return attempt(
    () => postDisputeMessage(user.id, isStaff(user.role), disputeId, { body: values.body, attachments: files, proposal }, new Date()),
    [`/disputes/${disputeId}`, `/admin/disputes/${disputeId}`],
  );
}

export async function acceptDisputeOfferAction(disputeId: string): Promise<DisputeActionResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, message: "Your session has expired." };
  const result = await attempt(() => acceptDisputeProposal(getChapa(), user.id, disputeId, new Date()), [`/disputes/${disputeId}`], "Refund on its way. The case is closed.");
  if (result.ok) await recordAudit({ actorId: user.id, action: "dispute.accept-offer", entity: "Dispute", entityId: disputeId, ipAddress: await getClientIp() });
  return result;
}

export async function escalateDisputeAction(disputeId: string): Promise<DisputeActionResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, message: "Your session has expired." };
  return attempt(() => escalateDispute(user.id, disputeId, new Date()), [`/disputes/${disputeId}`], "A specialist will review the case.");
}

export async function withdrawDisputeAction(disputeId: string): Promise<DisputeActionResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, message: "Your session has expired." };
  return attempt(() => withdrawDispute(user.id, disputeId, new Date()), [`/disputes/${disputeId}`], "Case withdrawn.");
}

export async function resolveDisputeAction(disputeId: string, values: { refund: string; note: string }): Promise<DisputeActionResult> {
  const auth = await authorize("dispute:resolve");
  if (!auth.ok) return { ok: false, message: auth.message };
  const refundAmount = values.refund.trim() ? parseMoneyInput(values.refund) : 0;
  if (refundAmount === null) return { ok: false, message: "Enter the refund amount, like 450 or 12.50 (0 for none)." };
  const result = await attempt(
    () => resolveDispute(getChapa(), auth.user.id, disputeId, { refundAmount, note: values.note }, new Date()),
    [`/admin/disputes/${disputeId}`, "/admin/disputes", `/disputes/${disputeId}`],
    "Decision recorded and both sides notified.",
  );
  if (result.ok) await recordAudit({ actorId: auth.user.id, action: "dispute.resolve", entity: "Dispute", entityId: disputeId, data: { refundAmount }, ipAddress: await getClientIp() });
  return result;
}

/**
 * Record the evidence staff sent to Chapa for a card dispute. Chapa handles
 * chargeback evidence through its dashboard and support team, not an API, so
 * this keeps the case file complete and tells both sides it was sent.
 */
export async function submitChargebackEvidenceAction(disputeId: string, values: { summary: string }): Promise<DisputeActionResult> {
  const auth = await authorize("dispute:resolve");
  if (!auth.ok) return { ok: false, message: auth.message };
  const dispute = await prisma.dispute.findUnique({ where: { id: disputeId }, select: { kind: true, status: true } });
  if (!dispute || dispute.kind !== "CHARGEBACK") return { ok: false, message: "This is not a card dispute." };
  const summary = values.summary.trim();
  if (summary.length < 40) return { ok: false, message: "Write the evidence summary for the bank (at least 40 characters)." };
  await prisma.disputeMessage.create({ data: { disputeId, authorId: auth.user.id, party: "STAFF", body: `Evidence sent to Chapa for the bank:\n\n${summary.slice(0, 4_000)}` } });
  await recordAudit({ actorId: auth.user.id, action: "chargeback.evidence", entity: "Dispute", entityId: disputeId, ipAddress: await getClientIp() });
  revalidatePath(`/admin/disputes/${disputeId}`);
  return { ok: true, message: "Evidence recorded. Send the same summary and files to Chapa from the merchant dashboard if you have not already." };
}
