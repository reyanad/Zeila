import { prisma, type Prisma } from "@marketplace/database";
import { intakeFieldSchema, type IntakeField } from "@marketplace/shared-types";
import { orderItemForUser } from "./access";
import { CheckoutError } from "./errors";
import { releaseEscrowNow } from "./escrow";
import { notifySubOrder } from "./notifications";
import { rollupOrderStatus } from "./fulfillment";
import { rollupSubOrderStatus } from "./status";

/**
 * Service work: one funded milestone per purchased package (created at
 * payment), the buyer's intake answers, deliveries with files, revision
 * rounds within the package's allowance, and approval, which releases the
 * escrow. Work the buyer never answers is auto-approved when the escrow hold
 * window ends.
 */

export interface AttachmentRef {
  key: string;
  fileName: string;
  sizeBytes: number;
}

export function asAttachments(value: Prisma.JsonValue): AttachmentRef[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) return [];
    const { key, fileName, sizeBytes } = entry as Record<string, unknown>;
    return typeof key === "string" && typeof fileName === "string" && typeof sizeBytes === "number" ? [{ key, fileName, sizeBytes }] : [];
  });
}

function revisionsAllowed(variantSnapshot: Prisma.JsonValue): number {
  const value = typeof variantSnapshot === "object" && variantSnapshot !== null && !Array.isArray(variantSnapshot) ? (variantSnapshot as Record<string, unknown>).revisions : null;
  return typeof value === "number" ? value : 0;
}

async function serviceItem(userId: string, orderItemId: string, expected: "buyer" | "seller") {
  const { item, role } = await orderItemForUser(userId, orderItemId);
  if (role !== expected) throw new CheckoutError(expected === "buyer" ? "Only the buyer can do that." : "Only the seller can do that.");
  if (item.listingType !== "SERVICE") throw new CheckoutError("That item is not a service.");
  if (["REFUNDED", "CANCELLED"].includes(item.status) || item.subOrder.status === "REFUNDED") throw new CheckoutError("This order was refunded.");
  return item;
}

/** Validate and store the buyer's answers to the seller's intake questions. */
export async function saveIntakeAnswers(buyerId: string, orderItemId: string, answers: Record<string, string>, files: Record<string, AttachmentRef>): Promise<void> {
  const item = await serviceItem(buyerId, orderItemId, "buyer");
  const form = await prisma.intakeForm.findUnique({ where: { listingId: item.listingId }, select: { id: true, fields: true } });
  if (!form) throw new CheckoutError("This service has no questions.");
  const fields: IntakeField[] = Array.isArray(form.fields) ? form.fields.flatMap((field) => {
    const parsed = intakeFieldSchema.safeParse(field);
    return parsed.success ? [parsed.data] : [];
  }) : [];

  const stored: Record<string, Prisma.InputJsonValue> = {};
  for (const field of fields) {
    if (field.kind === "file") {
      const file = files[field.id];
      if (!file && field.required) throw new CheckoutError(`Upload a file for “${field.label}”.`);
      if (file) stored[field.id] = { ...file };
      continue;
    }
    const value = (answers[field.id] ?? "").trim();
    if (!value && field.required) throw new CheckoutError(`Answer “${field.label}”.`);
    if (!value) continue;
    if (value.length > 5_000) throw new CheckoutError(`The answer to “${field.label}” is too long.`);
    if (field.kind === "select" && !field.options.includes(value)) throw new CheckoutError(`Choose an option for “${field.label}”.`);
    if (field.kind === "url" && !/^https?:\/\/\S+$/i.test(value)) throw new CheckoutError(`Enter a full link (https://…) for “${field.label}”.`);
    stored[field.id] = value;
  }
  await prisma.intakeFormResponse.upsert({
    where: { orderItemId: item.id },
    create: { intakeFormId: form.id, orderItemId: item.id, buyerId, answers: stored },
    update: { answers: stored, submittedAt: new Date() },
  });
  await notifySubOrder(item.subOrderId, "seller", { type: "SYSTEM", title: "Brief received for order {order}", body: `The buyer answered your questions for ${item.titleSnapshot}.` });
}

export async function startWork(sellerUserId: string, orderItemId: string, now: Date): Promise<void> {
  const item = await serviceItem(sellerUserId, orderItemId, "seller");
  if (item.status !== "PENDING") throw new CheckoutError("Work on this order has already started.");
  await prisma.$transaction(async (tx) => {
    await tx.orderItem.update({ where: { id: item.id }, data: { status: "FULFILLING" } });
    await tx.milestone.updateMany({ where: { orderItemId: item.id, status: "FUNDED" }, data: { status: "IN_PROGRESS" } });
    await rollupSubOrderStatus(tx, item.subOrderId, now);
    await rollupOrderStatus(tx, item.subOrder.orderId);
  });
}

export async function submitDelivery(sellerUserId: string, orderItemId: string, input: { message: string; files: AttachmentRef[] }, now: Date): Promise<void> {
  const item = await serviceItem(sellerUserId, orderItemId, "seller");
  if (item.status !== "FULFILLING" && item.status !== "PENDING") throw new CheckoutError("This work is not waiting for a delivery.");
  if (!input.message.trim() && input.files.length === 0) throw new CheckoutError("Add a message or attach the delivered files.");
  await prisma.$transaction(async (tx) => {
    const milestone = await tx.milestone.findFirst({ where: { orderItemId: item.id }, orderBy: { position: "asc" }, select: { id: true } });
    await tx.deliverable.create({
      data: {
        orderItemId: item.id,
        milestoneId: milestone?.id ?? null,
        message: input.message.trim().slice(0, 5_000) || null,
        files: input.files.map((file) => ({ ...file })),
        submittedAt: now,
      },
    });
    await tx.revision.updateMany({ where: { orderItemId: item.id, status: { in: ["REQUESTED", "IN_PROGRESS"] } }, data: { status: "DELIVERED", resolvedAt: now } });
    await tx.milestone.updateMany({ where: { orderItemId: item.id, status: { in: ["FUNDED", "IN_PROGRESS", "REVISION_REQUESTED"] } }, data: { status: "SUBMITTED", submittedAt: now } });
    await tx.orderItem.update({ where: { id: item.id }, data: { status: "DELIVERED", deliveredAt: now } });
    await rollupSubOrderStatus(tx, item.subOrderId, now);
    await rollupOrderStatus(tx, item.subOrder.orderId);
  });
  await notifySubOrder(item.subOrderId, "buyer", {
    type: "MILESTONE_SUBMITTED",
    title: "{store} delivered your work",
    body: `Review ${item.titleSnapshot}: approve it or ask for changes.`,
    href: `/orders/${item.subOrder.orderId}/work/${item.id}`,
  });
}

export async function requestRevision(buyerId: string, orderItemId: string, note: string, now: Date): Promise<void> {
  const item = await serviceItem(buyerId, orderItemId, "buyer");
  if (item.status !== "DELIVERED") throw new CheckoutError("You can ask for changes after the seller delivers.");
  const trimmed = note.trim();
  if (trimmed.length < 10) throw new CheckoutError("Describe what should change (at least 10 characters).");
  const allowed = revisionsAllowed(item.variantSnapshot);
  const used = await prisma.revision.count({ where: { orderItemId: item.id } });
  if (allowed >= 0 && used >= allowed) throw new CheckoutError(allowed === 0 ? "This package has no revision rounds." : `All ${allowed} revision rounds have been used.`);

  await prisma.$transaction(async (tx) => {
    await tx.revision.create({ data: { orderItemId: item.id, note: trimmed.slice(0, 5_000), status: "REQUESTED", requestedAt: now } });
    await tx.milestone.updateMany({ where: { orderItemId: item.id, status: "SUBMITTED" }, data: { status: "REVISION_REQUESTED" } });
    await tx.orderItem.update({ where: { id: item.id }, data: { status: "FULFILLING" } });
    // The sub-order is no longer fully delivered, which also pauses auto-release.
    await tx.subOrder.updateMany({ where: { id: item.subOrderId, status: "DELIVERED" }, data: { status: "IN_PROGRESS" } });
    await rollupOrderStatus(tx, item.subOrder.orderId);
  });
  await notifySubOrder(item.subOrderId, "seller", { type: "REVISION_REQUESTED", title: "Changes requested on order {order}", body: trimmed.slice(0, 300) });
}

/** Buyer accepts the work. When nothing else in the sub-order is pending, the seller is paid now. */
export async function approveDelivery(buyerId: string, orderItemId: string, now: Date): Promise<void> {
  const item = await serviceItem(buyerId, orderItemId, "buyer");
  if (item.status !== "DELIVERED") throw new CheckoutError("There is no delivery to approve yet.");
  const subOrderStatus = await prisma.$transaction(async (tx) => {
    await tx.milestone.updateMany({ where: { orderItemId: item.id, status: "SUBMITTED" }, data: { status: "APPROVED", approvedAt: now, approvedById: buyerId } });
    await tx.orderItem.update({ where: { id: item.id }, data: { status: "COMPLETED", completedAt: now } });
    const status = await rollupSubOrderStatus(tx, item.subOrderId, now);
    await rollupOrderStatus(tx, item.subOrder.orderId);
    return status;
  });
  await notifySubOrder(item.subOrderId, "seller", { type: "MILESTONE_APPROVED", title: "The buyer approved your work on order {order}", body: item.titleSnapshot });
  if (subOrderStatus === "COMPLETED") {
    const escrow = await prisma.escrow.findUnique({ where: { subOrderId: item.subOrderId }, select: { id: true } });
    if (escrow) await releaseEscrowNow(escrow.id, now, "buyer approved the work");
  }
}
