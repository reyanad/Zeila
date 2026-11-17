import type { Metadata } from "next";
import Link from "next/link";
import { prisma, type Prisma } from "@marketplace/database";
import { requirePermission } from "@/lib/admin";

export const metadata: Metadata = { title: "Audit log · Admin", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function AuditPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requirePermission("audit:view", "/admin/audit");
  const params = await searchParams;
  const action = typeof params.action === "string" ? params.action.trim().slice(0, 60) : "";
  const entityId = typeof params.entityId === "string" ? params.entityId.trim().slice(0, 60) : "";
  const where: Prisma.AuditLogWhereInput = { ...(action ? { action: { startsWith: action } } : {}), ...(entityId ? { entityId } : {}) };
  const entries = await prisma.auditLog.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: 200,
    select: { id: true, action: true, entity: true, entityId: true, data: true, ipAddress: true, createdAt: true, actor: { select: { id: true, email: true } } },
  });
  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-10">
      <h1 className="text-2xl font-semibold tracking-tight">Audit log</h1>
      <form className="flex flex-wrap gap-2" action="/admin/audit">
        <label className="sr-only" htmlFor="audit-action">
          Action
        </label>
        <input id="audit-action" name="action" defaultValue={action} placeholder="Action prefix, e.g. dispute. or kyc.approve" className="h-9 w-72 rounded-md border border-input bg-background px-3 text-sm" />
        <label className="sr-only" htmlFor="audit-entity">
          Record id
        </label>
        <input id="audit-entity" name="entityId" defaultValue={entityId} placeholder="Record id" className="h-9 w-64 rounded-md border border-input bg-background px-3 text-sm" />
        <button type="submit" className="h-9 rounded-md bg-primary px-4 text-sm text-primary-foreground">
          Filter
        </button>
      </form>
      <table className="w-full text-left text-xs">
        <thead className="text-muted-foreground">
          <tr>
            <th className="py-1 font-medium">When</th>
            <th className="py-1 font-medium">Who</th>
            <th className="py-1 font-medium">Action</th>
            <th className="py-1 font-medium">Record</th>
            <th className="py-1 font-medium">Details</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((entry) => (
            <tr key={entry.id} className="border-t border-border align-top">
              <td className="whitespace-nowrap py-2 pr-3">{entry.createdAt.toLocaleString("en-GB", { dateStyle: "short", timeStyle: "medium" })}</td>
              <td className="py-2 pr-3">
                {entry.actor ? (
                  <Link className="underline underline-offset-4" href={`/admin/users/${entry.actor.id}`}>
                    {entry.actor.email}
                  </Link>
                ) : (
                  "system"
                )}
                {entry.ipAddress ? <span className="block text-muted-foreground">{entry.ipAddress}</span> : null}
              </td>
              <td className="py-2 pr-3 font-mono">{entry.action}</td>
              <td className="py-2 pr-3">
                {entry.entity} <span className="font-mono text-muted-foreground">{entry.entityId}</span>
              </td>
              <td className="max-w-md py-2">
                <code className="break-all text-muted-foreground">{JSON.stringify(entry.data).slice(0, 300)}</code>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
