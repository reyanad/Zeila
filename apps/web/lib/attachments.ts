import "server-only";
import { asAttachments, type AttachmentRef } from "@marketplace/core";
import { signTicket, verifyTicket } from "@/lib/crypto/tokens";

/** Files attached to an order item (deliverables, intake answers) live under this prefix. */
export function attachmentPrefix(orderItemId: string): string {
  return `attachments/${orderItemId}`;
}

interface AttachmentTicket extends AttachmentRef {
  scope: "attachment";
  orderItemId: string;
}

export function signAttachment(orderItemId: string, file: AttachmentRef): string {
  const ticket: AttachmentTicket = { scope: "attachment", orderItemId, key: file.key, fileName: file.fileName, sizeBytes: file.sizeBytes };
  return signTicket("upload-ticket", ticket, 24 * 60 * 60);
}

/** Turn tokens from the browser back into trusted file references for this order item. */
export function verifyAttachments(orderItemId: string, tokens: readonly string[]): AttachmentRef[] | null {
  const files: AttachmentRef[] = [];
  for (const token of tokens.slice(0, 20)) {
    const ticket = verifyTicket<AttachmentTicket>("upload-ticket", token);
    if (!ticket || ticket.scope !== "attachment" || ticket.orderItemId !== orderItemId || !ticket.key.startsWith(`${attachmentPrefix(orderItemId)}/`)) return null;
    files.push({ key: ticket.key, fileName: ticket.fileName, sizeBytes: ticket.sizeBytes });
  }
  return files;
}

export { asAttachments, type AttachmentRef };
