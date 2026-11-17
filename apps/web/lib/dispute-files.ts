import "server-only";
import type { AttachmentRef } from "@marketplace/core";
import { prisma } from "@marketplace/database";
import { isStaff, type UserRoleValue } from "@marketplace/shared-types";
import { signTicket, verifyTicket } from "@/lib/crypto/tokens";

/** Evidence for disputes is stored per sub-order: `disputes/<subOrderId>/…`. */
export function disputeFilePrefix(subOrderId: string): string {
  return `disputes/${subOrderId}`;
}

/** Buyer, seller or staff may add or read evidence for a sub-order. */
export async function canAccessDisputeFiles(user: { id: string; role: UserRoleValue }, subOrderId: string): Promise<boolean> {
  if (isStaff(user.role)) return (await prisma.subOrder.count({ where: { id: subOrderId } })) > 0;
  const count = await prisma.subOrder.count({ where: { id: subOrderId, OR: [{ order: { buyerId: user.id } }, { store: { sellerId: user.id } }] } });
  return count > 0;
}

interface DisputeFileTicket extends AttachmentRef {
  scope: "dispute";
  subOrderId: string;
}

export function signDisputeFile(subOrderId: string, file: AttachmentRef): string {
  const ticket: DisputeFileTicket = { scope: "dispute", subOrderId, key: file.key, fileName: file.fileName, sizeBytes: file.sizeBytes };
  return signTicket("upload-ticket", ticket, 24 * 60 * 60);
}

export function verifyDisputeFiles(subOrderId: string, tokens: readonly string[]): AttachmentRef[] | null {
  const files: AttachmentRef[] = [];
  for (const token of tokens.slice(0, 10)) {
    const ticket = verifyTicket<DisputeFileTicket>("upload-ticket", token);
    if (!ticket || ticket.scope !== "dispute" || ticket.subOrderId !== subOrderId || !ticket.key.startsWith(`${disputeFilePrefix(subOrderId)}/`)) return null;
    files.push({ key: ticket.key, fileName: ticket.fileName, sizeBytes: ticket.sizeBytes });
  }
  return files;
}

export function disputeFileHref(subOrderId: string, file: AttachmentRef): string {
  return `/api/disputes/files/download?subOrderId=${encodeURIComponent(subOrderId)}&key=${encodeURIComponent(file.key)}&name=${encodeURIComponent(file.fileName)}`;
}
