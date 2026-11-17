import type { Metadata } from "next";
import Link from "next/link";
import { circumventionSignals } from "@marketplace/core";
import { prisma } from "@marketplace/database";
import { Badge } from "@marketplace/ui";
import { ActionButton } from "@/components/action-button";
import { setFraudFlagAction } from "@/lib/actions/admin";
import { requirePermission } from "@/lib/admin";

export const metadata: Metadata = { title: "Fraud · Admin", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function FraudPage() {
  await requirePermission("fraud:review", "/admin/fraud");
  const since = new Date(Date.now() - 30 * 86_400_000);
  const [flags, signals, chargebacks] = await Promise.all([
    prisma.fraudFlag.findMany({
      where: { status: { in: ["OPEN", "REVIEWING"] } },
      orderBy: { createdAt: "asc" },
      take: 100,
      select: {
        id: true,
        reason: true,
        details: true,
        status: true,
        createdAt: true,
        subjectUser: { select: { id: true, email: true, name: true } },
        store: { select: { name: true, sellerId: true } },
        listing: { select: { title: true, slug: true } },
        reporter: { select: { email: true } },
      },
    }),
    circumventionSignals(since),
    prisma.dispute.groupBy({ by: ["subOrderId"], where: { kind: "CHARGEBACK", createdAt: { gte: new Date(Date.now() - 90 * 86_400_000) } }, _count: { _all: true } }),
  ]);
  const chargebackStores = chargebacks.length
    ? await prisma.subOrder.groupBy({ by: ["storeId"], where: { id: { in: chargebacks.map((row) => row.subOrderId) } }, _count: { _all: true }, orderBy: { _count: { storeId: "desc" } }, take: 20 })
    : [];
  const stores = await prisma.store.findMany({ where: { id: { in: chargebackStores.map((row) => row.storeId) } }, select: { id: true, name: true, sellerId: true } });

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-8 px-4 py-10">
      <h1 className="text-2xl font-semibold tracking-tight">Fraud</h1>

      <section className="flex flex-col gap-3" aria-labelledby="flags-heading">
        <h2 id="flags-heading" className="font-medium">
          Open flags ({flags.length})
        </h2>
        {flags.length === 0 ? (
          <p className="rounded-md border border-dashed border-border p-8 text-center text-sm text-muted-foreground">No open flags.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-border rounded-md border border-border">
            {flags.map((flag) => (
              <li key={flag.id} className="flex flex-col gap-2 p-4 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium">{flag.reason}</span>
                  <Badge tone={flag.status === "OPEN" ? "warning" : "info"}>{flag.status.toLowerCase()}</Badge>
                </div>
                <p className="text-xs text-muted-foreground">
                  {flag.subjectUser ? (
                    <Link className="underline underline-offset-4" href={`/admin/users/${flag.subjectUser.id}`}>
                      {flag.subjectUser.name ?? flag.subjectUser.email}
                    </Link>
                  ) : null}
                  {flag.store ? ` · store ${flag.store.name}` : ""}
                  {flag.listing ? ` · listing ${flag.listing.title}` : ""} · reported {flag.reporter ? `by ${flag.reporter.email}` : "automatically"} on{" "}
                  {flag.createdAt.toLocaleDateString("en-GB", { dateStyle: "medium" })}
                </p>
                {flag.details && typeof flag.details === "object" && Object.keys(flag.details).length > 0 ? (
                  <pre className="overflow-x-auto rounded bg-muted p-2 text-xs">{JSON.stringify(flag.details, null, 2).slice(0, 1_500)}</pre>
                ) : null}
                <div className="flex flex-wrap gap-2">
                  {flag.status === "OPEN" ? <ActionButton variant="outline" action={setFraudFlagAction.bind(null, flag.id, "REVIEWING")} label="Start review" /> : null}
                  <ActionButton variant="destructive" action={setFraudFlagAction.bind(null, flag.id, "CONFIRMED")} label="Confirm fraud" confirm="Confirm this flag? Suspend the account from the user page if needed." />
                  <ActionButton variant="ghost" action={setFraudFlagAction.bind(null, flag.id, "DISMISSED")} label="Dismiss" />
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-3" aria-labelledby="signals-heading">
        <h2 id="signals-heading" className="font-medium">
          Repeated off-platform attempts (30 days)
        </h2>
        <p className="text-sm text-muted-foreground">Accounts with 3 or more chat messages that tried to share contact details or arrange payment outside the platform.</p>
        {signals.length === 0 ? (
          <p className="text-sm text-muted-foreground">None.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-border rounded-md border border-border text-sm">
            {signals.map((signal) => (
              <li key={signal.userId} className="flex items-center justify-between gap-3 p-3">
                <Link className="underline underline-offset-4" href={`/admin/users/${signal.userId}`}>
                  {signal.name ?? signal.email}
                </Link>
                <span className="tabular-nums">{signal.flagged} flagged messages</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-3" aria-labelledby="chargebacks-heading">
        <h2 id="chargebacks-heading" className="font-medium">
          Stores with card disputes (90 days)
        </h2>
        {chargebackStores.length === 0 ? (
          <p className="text-sm text-muted-foreground">None.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-border rounded-md border border-border text-sm">
            {chargebackStores.map((row) => {
              const store = stores.find((candidate) => candidate.id === row.storeId);
              return (
                <li key={row.storeId} className="flex items-center justify-between gap-3 p-3">
                  {store ? (
                    <Link className="underline underline-offset-4" href={`/admin/users/${store.sellerId}`}>
                      {store.name}
                    </Link>
                  ) : (
                    row.storeId
                  )}
                  <span className="tabular-nums">{row._count._all} disputed orders</span>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
