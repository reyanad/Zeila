import type { Metadata } from "next";
import Link from "next/link";
import { prisma } from "@marketplace/database";
import { countryName } from "@/lib/storefront/detail";
import { Badge } from "@marketplace/ui";
import { requirePermission } from "@/lib/admin";

export const metadata: Metadata = { title: "Identity checks · Admin", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function KycQueuePage() {
  await requirePermission("kyc:review", "/admin/kyc");
  const [pending, recent] = await Promise.all([
    prisma.kycSubmission.findMany({ where: { status: "PENDING" }, orderBy: { createdAt: "asc" }, take: 100, select: { id: true, legalName: true, country: true, createdAt: true, user: { select: { email: true, store: { select: { name: true } } } } } }),
    prisma.kycSubmission.findMany({ where: { status: { in: ["APPROVED", "REJECTED"] } }, orderBy: { reviewedAt: "desc" }, take: 20, select: { id: true, legalName: true, status: true, reviewedAt: true, reviewedBy: { select: { name: true } } } }),
  ]);
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-10">
      <h1 className="text-2xl font-semibold tracking-tight">Identity checks</h1>
      <section className="flex flex-col gap-3" aria-labelledby="pending-heading">
        <h2 id="pending-heading" className="font-medium">
          Waiting ({pending.length})
        </h2>
        {pending.length === 0 ? (
          <p className="rounded-md border border-dashed border-border p-8 text-center text-sm text-muted-foreground">Nothing to review.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-border rounded-md border border-border">
            {pending.map((submission) => (
              <li key={submission.id}>
                <Link href={`/admin/kyc/${submission.id}`} className="flex flex-wrap items-center justify-between gap-3 p-4 text-sm hover:bg-accent">
                  <span className="flex flex-col">
                    <span className="font-medium">{submission.legalName}</span>
                    <span className="text-xs text-muted-foreground">
                      {submission.user.store?.name ?? "No store yet"} · {submission.user.email} · {countryName(submission.country)}
                    </span>
                  </span>
                  <span className="text-xs text-muted-foreground">waiting since {submission.createdAt.toLocaleDateString("en-GB", { dateStyle: "medium" })}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
      {recent.length > 0 ? (
        <section className="flex flex-col gap-3" aria-labelledby="recent-heading">
          <h2 id="recent-heading" className="font-medium">
            Recently decided
          </h2>
          <ul className="flex flex-col divide-y divide-border rounded-md border border-border text-sm">
            {recent.map((submission) => (
              <li key={submission.id} className="flex items-center justify-between gap-3 p-3">
                <Link className="hover:underline" href={`/admin/kyc/${submission.id}`}>
                  {submission.legalName}
                </Link>
                <span className="flex items-center gap-2 text-xs text-muted-foreground">
                  {submission.reviewedBy?.name ?? "staff"} · {submission.reviewedAt?.toLocaleDateString("en-GB", { dateStyle: "medium" })}
                  <Badge tone={submission.status === "APPROVED" ? "success" : "danger"}>{submission.status.toLowerCase()}</Badge>
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
