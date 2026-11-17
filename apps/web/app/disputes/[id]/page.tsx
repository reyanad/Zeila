import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { minorToInput, isStaff } from "@marketplace/shared-types";
import { Alert, Badge, buttonVariants } from "@marketplace/ui";
import { ActionButton } from "@/components/action-button";
import { DisputeReplyForm } from "@/components/disputes/reply-form";
import { DisputeThread } from "@/components/disputes/dispute-thread";
import { formatPrice } from "@/components/storefront/price";
import { acceptDisputeOfferAction, escalateDisputeAction, withdrawDisputeAction } from "@/lib/actions/disputes";
import { requireUser } from "@/lib/auth/session";
import { DISPUTE_STATUS, loadDisputeView, OPEN_STATUSES } from "@/lib/disputes/view";

export const metadata: Metadata = { title: "Case", robots: { index: false } };
export const dynamic = "force-dynamic";

export default async function DisputePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser(`/disputes/${id}`);
  const dispute = await loadDisputeView(id);
  if (!dispute) notFound();
  const party = dispute.subOrder.order.buyerId === user.id ? "BUYER" : dispute.subOrder.store.sellerId === user.id ? "SELLER" : null;
  if (!party) {
    if (isStaff(user.role)) redirect(`/admin/disputes/${id}`);
    notFound();
  }
  const status = DISPUTE_STATUS[dispute.status] ?? { label: dispute.status, tone: "neutral" as const };
  const open = OPEN_STATUSES.includes(dispute.status);
  const claim = dispute.kind === "CLAIM";
  const currency = dispute.subOrder.currency;

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{claim ? "Case" : "Card dispute"} for order {dispute.subOrder.order.orderNumber}</h1>
          <p className="text-sm text-muted-foreground">Opened {dispute.createdAt.toLocaleDateString("en-GB", { dateStyle: "medium" })}</p>
        </div>
        <Badge tone={status.tone}>{status.label}</Badge>
      </div>

      {!claim ? (
        <Alert tone="warning">
          {party === "SELLER"
            ? "The buyer disputed the payment with their bank. Add tracking, delivery proof and messages below; the platform submits them to the bank."
            : "You disputed this payment with your bank. The bank decides; you can add information here."}
        </Alert>
      ) : null}

      <DisputeThread dispute={dispute} />

      {open && claim && party === "BUYER" && dispute.latestProposal !== null ? (
        <div className="flex flex-col gap-2 rounded-lg border-2 border-primary/40 p-4 text-sm">
          <p>
            The seller offers a refund of <strong>{formatPrice(Math.min(dispute.latestProposal, dispute.remaining), currency)}</strong> to settle this case.
          </p>
          <ActionButton
            action={acceptDisputeOfferAction.bind(null, dispute.id)}
            label="Accept and close the case"
            pendingLabel="Refunding…"
            confirm="Accept the seller's offer? You receive the refund and the case closes."
          />
        </div>
      ) : null}

      {open ? (
        <DisputeReplyForm
          disputeId={dispute.id}
          subOrderId={dispute.subOrderId}
          canPropose={party === "SELLER" && claim}
          currency={currency}
          label={party === "SELLER" ? "Your response" : "Add information"}
        />
      ) : null}

      {open && claim ? (
        <div className="flex flex-wrap gap-3">
          {dispute.status !== "UNDER_REVIEW" ? (
            <ActionButton
              variant="outline"
              action={escalateDisputeAction.bind(null, dispute.id)}
              label="Ask the platform to decide"
              confirm="A platform specialist will review the evidence from both sides and decide. Continue?"
            />
          ) : null}
          {party === "BUYER" ? (
            <ActionButton
              variant="ghost"
              action={withdrawDisputeAction.bind(null, dispute.id)}
              label="Withdraw the case"
              confirm="Withdraw this case? The seller's payment will be released as normal."
            />
          ) : null}
        </div>
      ) : null}

      <p className="text-xs text-muted-foreground">
        Remaining that can be refunded: {formatPrice(dispute.remaining, currency)} ({minorToInput(dispute.remaining)} {currency}).
      </p>
      <Link href={party === "BUYER" ? `/orders/${dispute.subOrder.orderId}` : `/seller/studio/orders/${dispute.subOrder.id}`} className={buttonVariants({ variant: "ghost", size: "sm" })}>
        Back to the order
      </Link>
    </div>
  );
}
