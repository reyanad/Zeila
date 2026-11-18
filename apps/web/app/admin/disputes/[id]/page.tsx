import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { minorToInput } from "@marketplace/shared-types";
import { Alert, Badge, buttonVariants } from "@marketplace/ui";
import { DisputeReplyForm } from "@/components/disputes/reply-form";
import { DisputeThread } from "@/components/disputes/dispute-thread";
import { ChargebackEvidenceForm, ResolveDisputeForm } from "@/components/disputes/staff-forms";
import { formatPrice } from "@/components/storefront/price";
import { requirePermission } from "@/lib/admin";
import { DISPUTE_STATUS, loadDisputeView, OPEN_STATUSES } from "@/lib/disputes/view";

export const metadata: Metadata = { title: "Case · Admin", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function AdminDisputePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await requirePermission("dispute:resolve", `/admin/disputes/${id}`);
  const dispute = await loadDisputeView(id);
  if (!dispute) notFound();
  const status = DISPUTE_STATUS[dispute.status] ?? { label: dispute.status, tone: "neutral" as const };
  const open = OPEN_STATUSES.includes(dispute.status);
  const currency = dispute.subOrder.currency;
  const money = (amount: number) => formatPrice(amount, currency);
  const evidenceSubmitted = dispute.messages.some((message) => message.party === "STAFF" && (message.body.startsWith("Evidence sent") || message.body.startsWith("Evidence submitted")));

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-10">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">
          {dispute.kind === "CHARGEBACK" ? "Card dispute" : "Case"} · {dispute.subOrder.order.orderNumber}
        </h1>
        <Badge tone={status.tone}>{status.label}</Badge>
      </div>
      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <div className="flex flex-col gap-6">
          <DisputeThread dispute={dispute} />
          {open ? <DisputeReplyForm disputeId={dispute.id} subOrderId={dispute.subOrderId} canPropose={false} currency={currency} label="Message both sides" /> : null}
          {open && dispute.kind === "CLAIM" ? (
            <ResolveDisputeForm disputeId={dispute.id} currency={currency} maxRefund={money(dispute.remaining)} suggested={dispute.latestProposal !== null ? minorToInput(Math.min(dispute.latestProposal, dispute.remaining)) : ""} />
          ) : null}
          {open && dispute.kind === "CHARGEBACK" ? (
            evidenceSubmitted ? <Alert tone="info">Evidence was recorded. Close the case once Chapa tells you the bank&apos;s decision.</Alert> : <ChargebackEvidenceForm disputeId={dispute.id} />
          ) : null}
        </div>
        <aside className="flex flex-col gap-4 text-sm">
          <section className="rounded-lg border border-border p-4">
            <h2 className="mb-2 font-medium">Parties</h2>
            <p>
              Buyer: {dispute.subOrder.order.buyer.name ?? "—"} <span className="block text-xs text-muted-foreground">{dispute.subOrder.order.buyer.email}</span>
            </p>
            <p className="mt-2">
              Seller:{" "}
              <Link className="underline underline-offset-4" href={`/store/${dispute.subOrder.store.slug}`}>
                {dispute.subOrder.store.name}
              </Link>
            </p>
          </section>
          <section className="rounded-lg border border-border p-4">
            <h2 className="mb-2 font-medium">Money</h2>
            <p>Paid: {money(dispute.subOrder.grandTotal)}</p>
            <p>Refunded: {money(dispute.subOrder.refundedTotal)}</p>
            <p>
              Escrow: {dispute.subOrder.escrow ? `${dispute.subOrder.escrow.status.toLowerCase()}, ${money(dispute.subOrder.escrow.amount - dispute.subOrder.escrow.refunded)}` : "none"}
            </p>
            {dispute.providerCaseId ? <p className="mt-2 text-xs text-muted-foreground">Chapa case {dispute.providerCaseId}</p> : null}
          </section>
          <section className="rounded-lg border border-border p-4">
            <h2 className="mb-2 font-medium">Items and delivery</h2>
            <ul className="flex flex-col gap-1">
              {dispute.subOrder.items.map((item, index) => (
                <li key={`${item.titleSnapshot}-${index}`}>
                  {item.quantity} × {item.titleSnapshot} <span className="text-xs text-muted-foreground">({item.listingType.toLowerCase()}, {item.status.toLowerCase()})</span>
                </li>
              ))}
            </ul>
            {dispute.subOrder.shipments.map((shipment, index) => (
              <p key={`${shipment.trackingNumber ?? "local"}-${index}`} className="mt-2 text-xs text-muted-foreground">
                {shipment.carrier} {shipment.trackingNumber ?? ""}: {shipment.status.toLowerCase()}
                {shipment.deliveredAt ? `, delivered ${shipment.deliveredAt.toLocaleDateString("en-GB", { dateStyle: "medium" })}` : ""}
              </p>
            ))}
          </section>
        </aside>
      </div>
      <Link href="/admin/disputes" className={buttonVariants({ variant: "ghost", size: "sm" })}>
        All cases
      </Link>
    </div>
  );
}
