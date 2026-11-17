import type { Metadata } from "next";
import { AFFILIATE_WINDOW_DAYS } from "@marketplace/core";
import { prisma } from "@marketplace/database";
import { Badge, Card, CardDescription, CardHeader, CardTitle } from "@marketplace/ui";
import { ActionButton } from "@/components/action-button";
import { CopyField } from "@/components/growth/copy-field";
import { formatPrice } from "@/components/storefront/price";
import { joinAffiliateAction } from "@/lib/actions/growth";
import { requireUser } from "@/lib/auth/session";
import { siteUrl } from "@/lib/env";

export const metadata: Metadata = { title: "Affiliate program", robots: { index: false } };
export const dynamic = "force-dynamic";

const STATUS_TONE = { PENDING: "warning", APPROVED: "info", PAID: "success", REVERSED: "neutral" } as const;

export default async function AffiliatesPage() {
  const user = await requireUser("/affiliates");
  const affiliate = await prisma.affiliate.findUnique({
    where: { userId: user.id },
    select: {
      id: true,
      code: true,
      status: true,
      clicks: true,
      commissionBps: true,
      referrals: { orderBy: { createdAt: "desc" }, take: 50, select: { id: true, status: true, commission: true, currency: true, createdAt: true, order: { select: { orderNumber: true } } } },
    },
  });

  if (!affiliate) {
    return (
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-10">
        <h1 className="text-2xl font-semibold tracking-tight">Earn by sharing</h1>
        <p className="text-muted-foreground">
          Share listings with your own referral link. When someone you referred buys within {AFFILIATE_WINDOW_DAYS} days, you earn a share of the platform&apos;s commission once their order is delivered and settled. Sellers pay nothing extra.
        </p>
        <div>
          <ActionButton action={joinAffiliateAction} label="Get my referral link" pendingLabel="Creating…" size="default" />
        </div>
      </div>
    );
  }

  const totals = new Map<string, { pending: number; approved: number; paid: number }>();
  for (const referral of affiliate.referrals) {
    const row = totals.get(referral.currency) ?? { pending: 0, approved: 0, paid: 0 };
    if (referral.status === "APPROVED") row.approved += referral.commission;
    if (referral.status === "PAID") row.paid += referral.commission;
    if (referral.status === "PENDING") row.pending += 1;
    totals.set(referral.currency, row);
  }
  const link = siteUrl(`/?ref=${affiliate.code}`);

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-10">
      <div className="flex items-center gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">Affiliate program</h1>
        <Badge tone={affiliate.status === "ACTIVE" ? "success" : "neutral"}>{affiliate.status.toLowerCase()}</Badge>
      </div>
      <div className="flex flex-col gap-2">
        <p className="text-sm">Your link (add <code className="rounded bg-muted px-1">?ref={affiliate.code}</code> to any listing URL too):</p>
        <CopyField value={link} label="Referral link" />
        <p className="text-xs text-muted-foreground">You earn {affiliate.commissionBps / 100}% of the platform&apos;s commission on referred orders, net of refunds.</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardHeader>
            <CardDescription>Link clicks</CardDescription>
            <CardTitle className="text-3xl tabular-nums">{affiliate.clicks}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>Referred orders</CardDescription>
            <CardTitle className="text-3xl tabular-nums">{affiliate.referrals.length}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>Earned (approved + paid)</CardDescription>
            <CardTitle className="text-xl tabular-nums">
              {totals.size === 0 ? "—" : [...totals.entries()].map(([currency, row]) => formatPrice(row.approved + row.paid, currency)).join(" · ")}
            </CardTitle>
          </CardHeader>
        </Card>
      </div>
      {affiliate.referrals.length > 0 ? (
        <ul className="flex flex-col divide-y divide-border rounded-md border border-border text-sm">
          {affiliate.referrals.map((referral) => (
            <li key={referral.id} className="flex items-center justify-between gap-3 p-3">
              <span>
                {referral.order?.orderNumber ?? "Order"} · {referral.createdAt.toLocaleDateString("en-GB", { dateStyle: "medium" })}
              </span>
              <span className="flex items-center gap-3">
                <span className="tabular-nums">{referral.status === "PENDING" ? "pending delivery" : formatPrice(referral.commission, referral.currency)}</span>
                <Badge tone={STATUS_TONE[referral.status]}>{referral.status.toLowerCase()}</Badge>
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">No referred orders yet.</p>
      )}
    </div>
  );
}
