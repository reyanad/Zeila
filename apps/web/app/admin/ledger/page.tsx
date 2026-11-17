import type { Metadata } from "next";
import { balancesByPrefix, escrowReconciliation, trialBalance } from "@marketplace/core";
import { prisma } from "@marketplace/database";
import { Badge } from "@marketplace/ui";
import { AffiliatePayout } from "@/components/admin/affiliate-payout";
import { formatPrice } from "@/components/storefront/price";
import { requirePermission } from "@/lib/admin";

export const metadata: Metadata = { title: "Ledger · Admin", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

function Check({ ok }: { ok: boolean }) {
  return <Badge tone={ok ? "success" : "danger"}>{ok ? "✓ matches" : "✗ mismatch"}</Badge>;
}

export default async function LedgerPage() {
  await requirePermission("ledger:reconcile", "/admin/ledger");
  const [trial, reconciliation, platform, due, losses, recent] = await Promise.all([
    trialBalance(),
    escrowReconciliation(),
    balancesByPrefix("platform:"),
    prisma.referral.groupBy({ by: ["affiliateId", "currency"], where: { status: "APPROVED" }, _sum: { commission: true }, _count: { _all: true } }),
    prisma.journalEntry.findMany({ where: { idempotencyKey: { startsWith: "chargeback-loss:" } }, orderBy: { occurredAt: "desc" }, take: 50, select: { id: true, description: true, occurredAt: true, metadata: true, lines: { select: { amount: true, direction: true, currency: true } } } }),
    prisma.journalEntry.findMany({ orderBy: { occurredAt: "desc" }, take: 25, select: { id: true, idempotencyKey: true, description: true, occurredAt: true, lines: { select: { amount: true, direction: true, currency: true, account: { select: { code: true } } } } } }),
  ]);
  const affiliates = await prisma.affiliate.findMany({ where: { id: { in: due.map((row) => row.affiliateId) } }, select: { id: true, code: true, user: { select: { email: true, name: true } } } });

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-4 py-10">
      <h1 className="text-2xl font-semibold tracking-tight">Ledger</h1>

      <section className="flex flex-col gap-3" aria-labelledby="trial-heading">
        <h2 id="trial-heading" className="font-medium">
          Trial balance
        </h2>
        <p className="text-sm text-muted-foreground">Debits minus credits across every entry must be zero in each currency.</p>
        {trial.length === 0 ? (
          <p className="text-sm text-muted-foreground">No entries yet.</p>
        ) : (
          <table className="w-full max-w-md text-left text-sm tabular-nums">
            <tbody>
              {trial.map((row) => (
                <tr key={row.currency} className="border-t border-border">
                  <td className="py-2">{row.currency}</td>
                  <td className="py-2 text-right">{row.difference}</td>
                  <td className="py-2 text-right">
                    <Check ok={row.difference === 0} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="flex flex-col gap-3" aria-labelledby="recon-heading">
        <h2 id="recon-heading" className="font-medium">
          Escrow and payouts against the records
        </h2>
        {reconciliation.length === 0 ? (
          <p className="text-sm text-muted-foreground">No escrow yet.</p>
        ) : (
          <table className="w-full text-left text-sm tabular-nums">
            <thead className="text-xs text-muted-foreground">
              <tr>
                <th className="py-1 font-medium">Currency</th>
                <th className="py-1 text-right font-medium">Escrow (ledger)</th>
                <th className="py-1 text-right font-medium">Escrow (held orders)</th>
                <th className="py-1 font-medium" />
                <th className="py-1 text-right font-medium">Payable (ledger)</th>
                <th className="py-1 text-right font-medium">Released, not transferred</th>
                <th className="py-1 font-medium" />
              </tr>
            </thead>
            <tbody>
              {reconciliation.map((row) => (
                <tr key={row.currency} className="border-t border-border">
                  <td className="py-2">{row.currency}</td>
                  <td className="py-2 text-right">{formatPrice(row.ledgerEscrow, row.currency)}</td>
                  <td className="py-2 text-right">{formatPrice(row.recordsEscrow, row.currency)}</td>
                  <td className="py-2 text-right">
                    <Check ok={row.ledgerEscrow === row.recordsEscrow} />
                  </td>
                  <td className="py-2 text-right">{formatPrice(row.ledgerPayable, row.currency)}</td>
                  <td className="py-2 text-right">{formatPrice(row.recordsPayable, row.currency)}</td>
                  <td className="py-2 text-right">
                    <Check ok={row.ledgerPayable === row.recordsPayable} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="flex flex-col gap-3" aria-labelledby="platform-heading">
        <h2 id="platform-heading" className="font-medium">
          Platform accounts
        </h2>
        <table className="w-full max-w-2xl text-left text-sm tabular-nums">
          <tbody>
            {platform
              .sort((a, b) => a.code.localeCompare(b.code))
              .map((row) => (
                <tr key={row.code} className="border-t border-border">
                  <td className="py-2">{row.name}</td>
                  <td className="py-2 text-xs text-muted-foreground">{row.type.toLowerCase()}</td>
                  <td className="py-2 text-right">{formatPrice(row.balance, row.currency)}</td>
                </tr>
              ))}
          </tbody>
        </table>
      </section>

      <section className="flex flex-col gap-3" aria-labelledby="affiliates-heading">
        <h2 id="affiliates-heading" className="font-medium">
          Affiliate commissions due
        </h2>
        {due.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing due.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-border rounded-md border border-border text-sm">
            {due.map((row) => {
              const affiliate = affiliates.find((candidate) => candidate.id === row.affiliateId);
              const amount = formatPrice(row._sum.commission ?? 0, row.currency);
              return (
                <li key={`${row.affiliateId}-${row.currency}`} className="flex flex-wrap items-center justify-between gap-3 p-3">
                  <span>
                    {affiliate?.user.name ?? affiliate?.user.email ?? row.affiliateId} <span className="text-xs text-muted-foreground">({affiliate?.code}, {row._count._all} orders)</span>
                  </span>
                  <span className="flex items-center gap-3">
                    <span className="font-medium tabular-nums">{amount}</span>
                    <AffiliatePayout affiliateId={row.affiliateId} currency={row.currency} amountLabel={amount} />
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-3" aria-labelledby="losses-heading">
        <h2 id="losses-heading" className="font-medium">
          Chargeback losses to recover from stores
        </h2>
        {losses.length === 0 ? (
          <p className="text-sm text-muted-foreground">None.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-border rounded-md border border-border text-sm">
            {losses.map((entry) => {
              const debit = entry.lines.find((line) => line.direction === "DEBIT");
              return (
                <li key={entry.id} className="flex flex-wrap items-center justify-between gap-3 p-3">
                  <span>{entry.description}</span>
                  <span className="tabular-nums">{debit ? formatPrice(debit.amount, debit.currency) : "—"}</span>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-3" aria-labelledby="journal-heading">
        <h2 id="journal-heading" className="font-medium">
          Latest journal entries
        </h2>
        <ul className="flex flex-col divide-y divide-border rounded-md border border-border text-xs">
          {recent.map((entry) => (
            <li key={entry.id} className="flex flex-col gap-1 p-3">
              <span className="flex flex-wrap justify-between gap-2">
                <span className="font-medium">{entry.description}</span>
                <span className="text-muted-foreground">{entry.occurredAt.toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}</span>
              </span>
              <span className="font-mono text-muted-foreground">{entry.idempotencyKey}</span>
              <span className="flex flex-col font-mono">
                {entry.lines.map((line, index) => (
                  <span key={`${entry.id}-${index}`}>
                    {line.direction === "DEBIT" ? "Dr" : "Cr"} {line.account.code} {formatPrice(line.amount, line.currency)}
                  </span>
                ))}
              </span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
