import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@marketplace/database";
import { hasPermission } from "@marketplace/shared-types";
import { Alert, Badge, buttonVariants } from "@marketplace/ui";
import { ActionButton } from "@/components/action-button";
import { RoleForm } from "@/components/admin/role-form";
import { SuspendForm } from "@/components/admin/suspend-form";
import { reinstateUserAction } from "@/lib/actions/admin";
import { requirePermission } from "@/lib/admin";

export const metadata: Metadata = { title: "User · Admin", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function AdminUserPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const staff = await requirePermission("user:suspend", `/admin/users/${id}`);
  const user = await prisma.user.findUnique({
    where: { id },
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      country: true,
      isSuspended: true,
      suspendedReason: true,
      emailVerified: true,
      twoFactorEnabled: true,
      lastLoginAt: true,
      createdAt: true,
      store: { select: { name: true, slug: true, status: true, payoutsEnabled: true, _count: { select: { listings: true } } } },
      _count: { select: { orders: true, disputesOpened: true, fraudFlagsAgainst: true, messages: { where: { flaggedCircumvention: true } } } },
    },
  });
  if (!user) notFound();
  const [audit, kyc] = await Promise.all([
    prisma.auditLog.findMany({ where: { OR: [{ actorId: user.id }, { entity: "User", entityId: user.id }] }, orderBy: { createdAt: "desc" }, take: 20, select: { id: true, action: true, entity: true, createdAt: true, ipAddress: true } }),
    prisma.kycSubmission.findFirst({ where: { userId: user.id }, orderBy: { createdAt: "desc" }, select: { id: true, status: true } }),
  ]);
  const facts: Array<[string, string]> = [
    ["E-mail", `${user.email}${user.emailVerified ? " (verified)" : " (not verified)"}`],
    ["Role", user.role.toLowerCase().replace("_", " ")],
    ["Country", user.country ?? "—"],
    ["Two-factor", user.twoFactorEnabled ? "on" : "off"],
    ["Joined", user.createdAt.toLocaleDateString("en-GB", { dateStyle: "medium" })],
    ["Last sign-in", user.lastLoginAt?.toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" }) ?? "—"],
    ["Orders", String(user._count.orders)],
    ["Cases opened", String(user._count.disputesOpened)],
    ["Fraud flags", String(user._count.fraudFlagsAgainst)],
    ["Flagged chat messages", String(user._count.messages)],
  ];

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-4 py-10">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">{user.name ?? user.email}</h1>
        {user.isSuspended ? <Badge tone="danger">suspended</Badge> : <Badge tone="success">active</Badge>}
      </div>
      {user.isSuspended ? <Alert tone="warning">Suspended: {user.suspendedReason ?? "no reason recorded"}</Alert> : null}
      <dl className="grid gap-3 rounded-lg border border-border p-4 text-sm sm:grid-cols-2">
        {facts.map(([label, value]) => (
          <div key={label}>
            <dt className="text-xs text-muted-foreground">{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      {user.store ? (
        <section className="rounded-lg border border-border p-4 text-sm">
          <h2 className="mb-2 font-medium">Store</h2>
          <p>
            <Link className="underline underline-offset-4" href={`/store/${user.store.slug}`}>
              {user.store.name}
            </Link>{" "}
            · {user.store.status.toLowerCase()} · {user.store._count.listings} listings · payouts {user.store.payoutsEnabled ? "on" : "off"}
            {kyc ? (
              <>
                {" "}
                ·{" "}
                <Link className="underline underline-offset-4" href={`/admin/kyc/${kyc.id}`}>
                  identity {kyc.status.toLowerCase()}
                </Link>
              </>
            ) : null}
          </p>
        </section>
      ) : null}
      <section className="flex flex-col gap-3 rounded-lg border border-border p-4">
        <h2 className="font-medium">Account actions</h2>
        {user.isSuspended ? (
          <div>
            <ActionButton action={reinstateUserAction.bind(null, user.id)} label="Reinstate" confirm="Lift the suspension? The store's status is recalculated from identity and payouts." />
          </div>
        ) : user.id === staff.id ? (
          <p className="text-sm text-muted-foreground">This is your account.</p>
        ) : (
          <SuspendForm userId={user.id} />
        )}
        {hasPermission(staff.role, "role:assign") && user.id !== staff.id ? <RoleForm userId={user.id} current={user.role} /> : null}
      </section>
      <section className="flex flex-col gap-2">
        <h2 className="font-medium">Recent activity</h2>
        <ul className="flex flex-col divide-y divide-border rounded-md border border-border text-xs">
          {audit.map((entry) => (
            <li key={entry.id} className="flex justify-between gap-3 p-2">
              <span>
                {entry.action} <span className="text-muted-foreground">({entry.entity})</span>
              </span>
              <span className="text-muted-foreground">
                {entry.createdAt.toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}
                {entry.ipAddress ? ` · ${entry.ipAddress}` : ""}
              </span>
            </li>
          ))}
        </ul>
      </section>
      <Link href="/admin/users" className={buttonVariants({ variant: "ghost", size: "sm" })}>
        All users
      </Link>
    </div>
  );
}
