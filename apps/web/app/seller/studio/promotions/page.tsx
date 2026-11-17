import type { Metadata } from "next";
import { prisma } from "@marketplace/database";
import { Badge } from "@marketplace/ui";
import { ActionButton } from "@/components/action-button";
import { FlashSaleForm } from "@/components/growth/flash-sale-form";
import { PromoForm } from "@/components/growth/promo-form";
import { formatPrice } from "@/components/storefront/price";
import { endFlashSaleAction, setPromoActiveAction } from "@/lib/actions/growth";
import { requireStudio } from "@/lib/studio/context";

export const metadata: Metadata = { title: "Promotions" };
export const dynamic = "force-dynamic";

function saleState(sale: { isActive: boolean; startsAt: Date; endsAt: Date }, now: Date): { label: string; tone: "success" | "info" | "neutral" } {
  if (!sale.isActive || sale.endsAt <= now) return { label: "Ended", tone: "neutral" };
  if (sale.startsAt > now) return { label: "Scheduled", tone: "info" };
  return { label: "Live", tone: "success" };
}

export default async function PromotionsPage() {
  const { store } = await requireStudio("/seller/studio/promotions");
  const now = new Date();
  const [listings, sales, codes] = await Promise.all([
    prisma.listing.findMany({ where: { storeId: store.id, status: { in: ["ACTIVE", "PAUSED"] } }, orderBy: { updatedAt: "desc" }, take: 200, select: { id: true, title: true } }),
    prisma.flashSale.findMany({
      where: { storeId: store.id },
      orderBy: { createdAt: "desc" },
      take: 30,
      select: { id: true, name: true, discountBps: true, startsAt: true, endsAt: true, isActive: true, listings: { select: { soldCount: true, quantityCap: true } } },
    }),
    prisma.promoCode.findMany({
      where: { storeId: store.id },
      orderBy: { createdAt: "desc" },
      take: 50,
      select: { id: true, code: true, type: true, value: true, currency: true, minSubtotal: true, usageLimit: true, perUserLimit: true, expiresAt: true, isActive: true, _count: { select: { redemptions: true } } },
    }),
  ]);
  const when = (date: Date) => date.toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" });

  return (
    <div className="flex flex-col gap-8">
      <h1 className="text-2xl font-semibold tracking-tight">Promotions</h1>

      <section className="flex flex-col gap-4" aria-labelledby="flash-heading">
        <h2 id="flash-heading" className="text-lg font-semibold">Flash sales</h2>
        <FlashSaleForm listings={listings} />
        {sales.length > 0 ? (
          <ul className="flex flex-col divide-y divide-border rounded-md border border-border">
            {sales.map((sale) => {
              const state = saleState(sale, now);
              const sold = sale.listings.reduce((sum, line) => sum + line.soldCount, 0);
              return (
                <li key={sale.id} className="flex flex-wrap items-center justify-between gap-3 p-4 text-sm">
                  <span className="flex flex-col">
                    <span className="font-medium">
                      {sale.name} · {Math.round(sale.discountBps / 100)}% off
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {when(sale.startsAt)} → {when(sale.endsAt)} · {sale.listings.length} listing{sale.listings.length === 1 ? "" : "s"} · {sold} sold at sale price
                    </span>
                  </span>
                  <span className="flex items-center gap-3">
                    <Badge tone={state.tone}>{state.label}</Badge>
                    {state.label !== "Ended" ? (
                      <ActionButton variant="outline" action={endFlashSaleAction.bind(null, sale.id)} label={state.label === "Live" ? "End now" : "Cancel"} confirm="End this sale now? Orders already placed keep their price." />
                    ) : null}
                  </span>
                </li>
              );
            })}
          </ul>
        ) : null}
      </section>

      <section className="flex flex-col gap-4" aria-labelledby="codes-heading">
        <h2 id="codes-heading" className="text-lg font-semibold">Coupon codes</h2>
        <PromoForm currency={store.currency} />
        {codes.length > 0 ? (
          <ul className="flex flex-col divide-y divide-border rounded-md border border-border">
            {codes.map((code) => (
              <li key={code.id} className="flex flex-wrap items-center justify-between gap-3 p-4 text-sm">
                <span className="flex flex-col">
                  <span className="font-mono font-medium">{code.code}</span>
                  <span className="text-xs text-muted-foreground">
                    {code.type === "PERCENT" ? `${code.value / 100}% off` : `${formatPrice(code.value, code.currency ?? store.currency)} off`}
                    {code.minSubtotal > 0 ? ` · min ${formatPrice(code.minSubtotal, code.currency ?? store.currency)}` : ""} · used {code._count.redemptions}
                    {code.usageLimit !== null ? ` of ${code.usageLimit}` : ""} · {code.perUserLimit} per buyer
                    {code.expiresAt ? ` · expires ${when(code.expiresAt)}` : ""}
                  </span>
                </span>
                <span className="flex items-center gap-3">
                  <Badge tone={code.isActive ? "success" : "neutral"}>{code.isActive ? "Active" : "Off"}</Badge>
                  <ActionButton variant="outline" action={setPromoActiveAction.bind(null, code.id, !code.isActive)} label={code.isActive ? "Turn off" : "Turn on"} />
                </span>
              </li>
            ))}
          </ul>
        ) : null}
      </section>
    </div>
  );
}
