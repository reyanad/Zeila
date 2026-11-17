import type { Metadata } from "next";
import Link from "next/link";
import { prisma, type Prisma } from "@marketplace/database";
import { DISPUTE_REASONS, isDisputeReason } from "@marketplace/shared-types";
import { Badge } from "@marketplace/ui";
import { formatPrice } from "@/components/storefront/price";
import { requirePermission } from "@/lib/admin";
import { DISPUTE_STATUS } from "@/lib/disputes/view";

export const metadata: Metadata = { title: "Resolution center · Admin", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

const TABS = {
  decide: { label: "Needs a decision", where: { kind: "CLAIM", status: "UNDER_REVIEW" } },
  chargebacks: { label: "Card disputes", where: { kind: "CHARGEBACK", status: { in: ["OPEN", "UNDER_REVIEW"] } } },
  waiting: { label: "Waiting on buyer or seller", where: { status: { in: ["OPEN", "AWAITING_SELLER", "AWAITING_BUYER"] } } },
  closed: { label: "Closed", where: { status: { in: ["RESOLVED_BUYER", "RESOLVED_SELLER", "RESOLVED_SPLIT", "CLOSED"] } } },
} satisfies Record<string, { label: string; where: Prisma.DisputeWhereInput }>;

export default async function AdminDisputesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requirePermission("dispute:resolve", "/admin/disputes");
  const params = await searchParams;
  const tab = typeof params.tab === "string" && params.tab in TABS ? (params.tab as keyof typeof TABS) : "decide";
  const [disputes, counts] = await Promise.all([
    prisma.dispute.findMany({
      where: TABS[tab].where,
      orderBy: tab === "closed" ? { resolvedAt: "desc" } : { createdAt: "asc" },
      take: 100,
      select: {
        id: true,
        kind: true,
        status: true,
        reason: true,
        createdAt: true,
        evidenceDueBy: true,
        subOrder: { select: { grandTotal: true, currency: true, order: { select: { orderNumber: true } }, store: { select: { name: true } } } },
      },
    }),
    Promise.all(Object.values(TABS).map((value) => prisma.dispute.count({ where: value.where }))),
  ]);

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-10">
      <h1 className="text-2xl font-semibold tracking-tight">Resolution center</h1>
      <nav aria-label="Queues" className="flex flex-wrap gap-2">
        {Object.entries(TABS).map(([key, value], index) => (
          <Link
            key={key}
            href={`/admin/disputes?tab=${key}`}
            aria-current={key === tab ? "page" : undefined}
            className={`rounded-full px-3 py-1 text-sm ${key === tab ? "bg-primary text-primary-foreground" : "bg-muted hover:bg-accent"}`}
          >
            {value.label} ({counts[index] ?? 0})
          </Link>
        ))}
      </nav>
      {disputes.length === 0 ? (
        <p className="rounded-md border border-dashed border-border p-10 text-center text-sm text-muted-foreground">Queue is empty.</p>
      ) : (
        <ul className="flex flex-col divide-y divide-border rounded-md border border-border">
          {disputes.map((dispute) => {
            const status = DISPUTE_STATUS[dispute.status] ?? { label: dispute.status, tone: "neutral" as const };
            return (
              <li key={dispute.id}>
                <Link href={`/admin/disputes/${dispute.id}`} className="flex flex-wrap items-center justify-between gap-3 p-4 hover:bg-accent">
                  <span className="flex flex-col">
                    <span className="font-medium">
                      {dispute.subOrder.order.orderNumber} · {dispute.subOrder.store.name} · {formatPrice(dispute.subOrder.grandTotal, dispute.subOrder.currency)}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {dispute.kind === "CHARGEBACK" ? "Card dispute" : isDisputeReason(dispute.reason) ? DISPUTE_REASONS[dispute.reason] : dispute.reason} · opened{" "}
                      {dispute.createdAt.toLocaleDateString("en-GB", { dateStyle: "medium" })}
                      {dispute.evidenceDueBy ? ` · evidence due ${dispute.evidenceDueBy.toLocaleDateString("en-GB", { dateStyle: "medium" })}` : ""}
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
