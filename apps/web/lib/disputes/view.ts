import "server-only";
import { asAttachments, type AttachmentRef } from "@marketplace/core";
import { prisma, type DisputeStatus } from "@marketplace/database";

export const DISPUTE_STATUS: Record<string, { label: string; tone: "info" | "success" | "warning" | "danger" | "neutral" }> = {
  OPEN: { label: "Open", tone: "warning" },
  AWAITING_SELLER: { label: "Waiting for the seller", tone: "warning" },
  AWAITING_BUYER: { label: "Waiting for the buyer", tone: "warning" },
  UNDER_REVIEW: { label: "With the platform", tone: "danger" },
  RESOLVED_BUYER: { label: "Resolved: refunded", tone: "success" },
  RESOLVED_SELLER: { label: "Resolved: no refund", tone: "neutral" },
  RESOLVED_SPLIT: { label: "Resolved: partial refund", tone: "success" },
  CLOSED: { label: "Closed", tone: "neutral" },
};

export const OPEN_STATUSES: DisputeStatus[] = ["OPEN", "AWAITING_SELLER", "AWAITING_BUYER", "UNDER_REVIEW"];

export interface DisputeMessageView {
  id: string;
  party: string;
  authorName: string | null;
  body: string;
  attachments: AttachmentRef[];
  proposal: number | null;
  createdAt: Date;
}

export async function loadDisputeView(disputeId: string) {
  const dispute = await prisma.dispute.findUnique({
    where: { id: disputeId },
    select: {
      id: true,
      kind: true,
      status: true,
      reason: true,
      description: true,
      resolution: true,
      refundAmount: true,
      respondBy: true,
      evidenceDueBy: true,
      stripeDisputeId: true,
      createdAt: true,
      subOrderId: true,
      orderItem: { select: { titleSnapshot: true } },
      subOrder: {
        select: {
          id: true,
          orderId: true,
          currency: true,
          grandTotal: true,
          refundedTotal: true,
          status: true,
          order: { select: { orderNumber: true, buyerId: true, buyer: { select: { name: true, email: true } } } },
          store: { select: { sellerId: true, name: true, slug: true } },
          escrow: { select: { status: true, amount: true, refunded: true } },
          items: { select: { titleSnapshot: true, quantity: true, lineTotal: true, listingType: true, status: true } },
          shipments: { select: { carrier: true, trackingNumber: true, status: true, deliveredAt: true } },
        },
      },
      messages: { orderBy: { createdAt: "asc" }, select: { id: true, party: true, body: true, attachments: true, proposal: true, createdAt: true, author: { select: { name: true } } } },
    },
  });
  if (!dispute) return null;
  const messages: DisputeMessageView[] = dispute.messages.map((message) => ({
    id: message.id,
    party: message.party,
    authorName: message.author?.name ?? null,
    body: message.body,
    attachments: asAttachments(message.attachments),
    proposal: message.proposal,
    createdAt: message.createdAt,
  }));
  const latestProposal = [...messages].reverse().find((message) => message.party === "SELLER" && message.proposal !== null)?.proposal ?? null;
  return { ...dispute, messages, latestProposal, remaining: dispute.subOrder.grandTotal - dispute.subOrder.refundedTotal };
}

export type DisputeView = NonNullable<Awaited<ReturnType<typeof loadDisputeView>>>;
