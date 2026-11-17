import type { Metadata } from "next";
import Link from "next/link";
import { prisma } from "@marketplace/database";
import { hasPermission, STAFF_ROLES } from "@marketplace/shared-types";
import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle } from "@marketplace/ui";
import { requireRole } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Admin", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

/** Staff landing page: the queues waiting for someone, each linking to its workspace. */
export default async function AdminPage() {
  const user = await requireRole(STAFF_ROLES, "/admin");
  const canReviewKyc = hasPermission(user.role, "kyc:review");

  const [pendingKyc, storesInReview, openFraudFlags, casesToDecide, listingsToReview] = await Promise.all([
    canReviewKyc ? prisma.kycSubmission.count({ where: { status: "PENDING" } }) : Promise.resolve(0),
    prisma.store.count({ where: { status: "PENDING_REVIEW" } }),
    prisma.fraudFlag.count({ where: { status: "OPEN" } }),
    prisma.dispute.count({ where: { OR: [{ kind: "CLAIM", status: "UNDER_REVIEW" }, { kind: "CHARGEBACK", status: { in: ["OPEN", "UNDER_REVIEW"] } }] } }),
    prisma.listing.count({ where: { status: "PENDING_REVIEW" } }),
  ]);

  const queues = [
    { label: "Identity checks waiting", value: pendingKyc, href: canReviewKyc ? "/admin/kyc" : null },
    { label: "Stores waiting for review", value: storesInReview, href: canReviewKyc ? "/admin/kyc" : null },
    { label: "Open fraud flags", value: openFraudFlags, href: "/admin/fraud" },
    { label: "Listings waiting for review", value: listingsToReview, href: "/admin/listings" },
    { label: "Cases needing a decision", value: casesToDecide, href: "/admin/disputes" },
  ];

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-10">
      <div className="flex items-center gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">Admin</h1>
        <Badge tone="info">{user.role === "SUPER_ADMIN" ? "Super admin" : "Moderator"}</Badge>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {queues.map((queue) => (
          <Card key={queue.label}>
            <CardHeader>
              <CardDescription>{queue.label}</CardDescription>
              <CardTitle className="text-3xl tabular-nums">{queue.value}</CardTitle>
            </CardHeader>
            <CardContent>
              {queue.href ? (
                <Link href={queue.href} className="text-sm font-medium underline underline-offset-4">
                  Open queue
                </Link>
              ) : null}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
