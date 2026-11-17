"use client";

import type { OfferPayload } from "@marketplace/shared-types";
import { Badge } from "@marketplace/ui";
import { ActionButton } from "@/components/action-button";
import { acceptOfferAction, closeOfferAction } from "@/lib/actions/messaging";

const STATUS: Record<OfferPayload["status"], { label: string; tone: "info" | "success" | "neutral" | "warning" }> = {
  OPEN: { label: "Open", tone: "info" },
  ACCEPTED: { label: "Accepted", tone: "success" },
  DECLINED: { label: "Declined", tone: "neutral" },
  WITHDRAWN: { label: "Withdrawn", tone: "neutral" },
  EXPIRED: { label: "Expired", tone: "neutral" },
};

export function OfferCard({ conversationId, messageId, offer, price, mine, expired }: {
  conversationId: string;
  messageId: string;
  offer: OfferPayload;
  /** Pre-formatted price. */
  price: string;
  mine: boolean;
  expired: boolean;
}) {
  const status = expired && offer.status === "OPEN" ? STATUS.EXPIRED : STATUS[offer.status];
  return (
    <div className="flex flex-col gap-2 rounded-lg border-2 border-primary/30 bg-card p-4 text-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Custom offer</p>
          <p className="font-medium">{offer.title}</p>
        </div>
        <Badge tone={status.tone}>{status.label}</Badge>
      </div>
      <p className="whitespace-pre-wrap text-muted-foreground">{offer.description}</p>
      <dl className="grid grid-cols-3 gap-2 text-xs">
        <div>
          <dt className="text-muted-foreground">Price</dt>
          <dd className="font-medium tabular-nums">{price}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Delivery</dt>
          <dd className="font-medium">
            {offer.deliveryDays} day{offer.deliveryDays === 1 ? "" : "s"}
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Revisions</dt>
          <dd className="font-medium">{offer.revisions < 0 ? "Unlimited" : offer.revisions}</dd>
        </div>
      </dl>
      {offer.status === "OPEN" && !expired ? (
        <div className="flex flex-wrap gap-2">
          {mine ? (
            <ActionButton variant="outline" action={closeOfferAction.bind(null, conversationId, messageId, "withdraw")} label="Withdraw offer" />
          ) : (
            <>
              <ActionButton action={acceptOfferAction.bind(null, messageId)} label="Accept and pay" pendingLabel="Preparing checkout…" />
              <ActionButton variant="ghost" action={closeOfferAction.bind(null, conversationId, messageId, "decline")} label="Decline" />
            </>
          )}
        </div>
      ) : null}
      {offer.status === "ACCEPTED" && !mine && offer.orderId ? (
        <ActionButton action={acceptOfferAction.bind(null, messageId)} label="Go to payment or order" variant="outline" />
      ) : null}
      <p className="text-xs text-muted-foreground">Paid through the platform and held in escrow until the work is approved.</p>
    </div>
  );
}
