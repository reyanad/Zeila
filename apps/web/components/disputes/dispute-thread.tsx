import { DISPUTE_REASONS, isDisputeReason } from "@marketplace/shared-types";
import { formatPrice } from "@/components/storefront/price";
import { disputeFileHref } from "@/lib/dispute-files";
import type { DisputeView } from "@/lib/disputes/view";

const PARTY_LABEL: Record<string, string> = { BUYER: "Buyer", SELLER: "Seller", STAFF: "Platform specialist", SYSTEM: "Update" };

export function DisputeThread({ dispute }: { dispute: DisputeView }) {
  return (
    <div className="flex flex-col gap-4">
      <dl className="grid gap-x-6 gap-y-2 rounded-lg border border-border p-4 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-xs text-muted-foreground">Problem</dt>
          <dd>{isDisputeReason(dispute.reason) ? DISPUTE_REASONS[dispute.reason] : dispute.reason}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Order</dt>
          <dd>
            {dispute.subOrder.order.orderNumber} · {dispute.subOrder.store.name}
            {dispute.orderItem ? ` · ${dispute.orderItem.titleSnapshot}` : ""}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Paid</dt>
          <dd className="tabular-nums">
            {formatPrice(dispute.subOrder.grandTotal, dispute.subOrder.currency)}
            {dispute.subOrder.refundedTotal > 0 ? ` (refunded ${formatPrice(dispute.subOrder.refundedTotal, dispute.subOrder.currency)})` : ""}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">{dispute.kind === "CHARGEBACK" ? "Bank evidence due" : "Reply due"}</dt>
          <dd>{(dispute.kind === "CHARGEBACK" ? dispute.evidenceDueBy : dispute.respondBy)?.toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" }) ?? "—"}</dd>
        </div>
      </dl>
      <ol className="flex flex-col gap-3" aria-label="Case history">
        {dispute.messages.map((message) => (
          <li key={message.id} className={`rounded-lg p-3 text-sm ${message.party === "STAFF" ? "border-2 border-primary/40" : message.party === "SYSTEM" ? "bg-muted/40" : "border border-border"}`}>
            <p className="text-xs text-muted-foreground">
              {PARTY_LABEL[message.party] ?? message.party}
              {message.authorName && message.party !== "SYSTEM" ? ` · ${message.authorName}` : ""} · {message.createdAt.toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}
            </p>
            {message.body ? <p className="mt-1 whitespace-pre-wrap">{message.body}</p> : null}
            {message.proposal !== null ? (
              <p className="mt-2 rounded bg-muted px-2 py-1 font-medium">Offers a refund of {formatPrice(message.proposal, dispute.subOrder.currency)} to settle</p>
            ) : null}
            {message.attachments.length > 0 ? (
              <ul className="mt-2 flex flex-col gap-1">
                {message.attachments.map((file) => (
                  <li key={file.key}>
                    <a className="underline underline-offset-4" href={disputeFileHref(dispute.subOrderId, file)}>
                      {file.fileName}
                    </a>
                  </li>
                ))}
              </ul>
            ) : null}
          </li>
        ))}
      </ol>
      {dispute.resolution ? <p className="rounded-lg bg-muted p-3 text-sm">Outcome: {dispute.resolution}</p> : null}
    </div>
  );
}
