import type { Metadata } from "next";
import Link from "next/link";
import { prisma } from "@marketplace/database";
import { DISPUTE_REASONS, isDisputeReason } from "@marketplace/shared-types";
import { Badge } from "@marketplace/ui";
import { requireUser } from "@/lib/auth/session";
import { DISPUTE_STATUS } from "@/lib/disputes/view";

export const metadata: Metadata = { title: "Resolution center", robots: { index: false } };
export const dynamic = "force-dynamic";

export default async function DisputesPage() {
  const user = await requireUser("/disputes");
  const disputes = await prisma.dispute.findMany({
    where: { OR: [{ subOrder: { order: { buyerId: user.id } } }, { subOrder: { store: { sellerId: user.id } } }] },
    orderBy: { updatedAt: "desc" },
    take: 100,
    select: {
      id: true,
      kind: true,
      status: true,
      reason: true,
      updatedAt: true,
      subOrder: { select: { order: { select: { orderNumber: true, buyerId: true } }, store: { select: { name: true } } } },
    },
  });
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Resolution center</h1>
        <p className="text-sm text-muted-foreground">Problems with an order are settled here, while the payment is still held in escrow. Open a case from the order page.</p>
      </div>
      {disputes.length === 0 ? (
        <p className="rounded-md border border-dashed border-border p-10 text-center text-sm text-muted-foreground">No cases.</p>
      ) : (
        <ul className="flex flex-col divide-y divide-border rounded-md border border-border">
          {disputes.map((dispute) => {
            const status = DISPUTE_STATUS[dispute.status] ?? { label: dispute.status, tone: "neutral" as const };
            const asBuyer = dispute.subOrder.order.buyerId === user.id;
            return (
              <li key={dispute.id}>
                <Link href={`/disputes/${dispute.id}`} className="flex flex-wrap items-center justify-between gap-3 p-4 hover:bg-accent">
                  <span className="flex flex-col">
                    <span className="font-medium">
                      {dispute.subOrder.order.orderNumber} · {asBuyer ? dispute.subOrder.store.name : "your store"}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {dispute.kind === "CHARGEBACK" ? "Card dispute" : isDisputeReason(dispute.reason) ? DISPUTE_REASONS[dispute.reason] : dispute.reason} · updated{" "}
                      {dispute.updatedAt.toLocaleDateString("en-GB", { dateStyle: "medium" })}
                    </span>
                  </span>
                  <Badge tone={status.tone}>{status.label}</Badge>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
