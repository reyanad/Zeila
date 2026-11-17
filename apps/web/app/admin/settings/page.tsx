import type { Metadata } from "next";
import { getSetting } from "@marketplace/core";
import { SettingsForm } from "@/components/admin/settings-form";
import { requirePermission } from "@/lib/admin";

export const metadata: Metadata = { title: "Settings · Admin", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  await requirePermission("platform:configure", "/admin/settings");
  const [feeBps, holdDays, reviewMode, taxRates] = await Promise.all([getSetting("platformFeeBps"), getSetting("escrowHoldDays"), getSetting("listingReviewMode"), getSetting("taxRates")]);
  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-4 py-10">
      <h1 className="text-2xl font-semibold tracking-tight">Platform settings</h1>
      <SettingsForm initial={{ feePercent: String(feeBps / 100), holdDays: String(holdDays), reviewMode, taxRates: JSON.stringify(taxRates, null, 2) }} />
    </div>
  );
}
