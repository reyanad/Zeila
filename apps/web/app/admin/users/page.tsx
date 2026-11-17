import type { Metadata } from "next";
import Link from "next/link";
import { prisma, type Prisma } from "@marketplace/database";
import { Badge } from "@marketplace/ui";
import { requirePermission } from "@/lib/admin";

export const metadata: Metadata = { title: "Users · Admin", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function UsersPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requirePermission("user:suspend", "/admin/users");
  const params = await searchParams;
  const query = typeof params.q === "string" ? params.q.trim().slice(0, 100) : "";
  const suspended = params.suspended === "1";
  const where: Prisma.UserWhereInput = {
    ...(query ? { OR: [{ email: { contains: query, mode: "insensitive" } }, { name: { contains: query, mode: "insensitive" } }, { store: { name: { contains: query, mode: "insensitive" } } }] } : {}),
    ...(suspended ? { isSuspended: true } : {}),
  };
  const users = await prisma.user.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: 50,
    select: { id: true, email: true, name: true, role: true, isSuspended: true, createdAt: true, store: { select: { name: true, status: true } } },
  });
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-10">
      <h1 className="text-2xl font-semibold tracking-tight">Users</h1>
      <form className="flex flex-wrap gap-2" action="/admin/users">
        <label htmlFor="user-search" className="sr-only">
          Search users
        </label>
        <input id="user-search" name="q" defaultValue={query} placeholder="E-mail, name or store" className="h-9 flex-1 rounded-md border border-input bg-background px-3 text-sm" />
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="suspended" value="1" defaultChecked={suspended} className="h-4 w-4" />
          Suspended only
        </label>
        <button type="submit" className="h-9 rounded-md bg-primary px-4 text-sm text-primary-foreground">
          Search
        </button>
      </form>
      <ul className="flex flex-col divide-y divide-border rounded-md border border-border">
        {users.map((user) => (
          <li key={user.id}>
            <Link href={`/admin/users/${user.id}`} className="flex flex-wrap items-center justify-between gap-3 p-3 text-sm hover:bg-accent">
              <span className="flex flex-col">
                <span className="font-medium">{user.name ?? user.email}</span>
                <span className="text-xs text-muted-foreground">
                  {user.email}
                  {user.store ? ` · ${user.store.name} (${user.store.status.toLowerCase()})` : ""} · joined {user.createdAt.toLocaleDateString("en-GB", { dateStyle: "medium" })}
                </span>
              </span>
              <span className="flex items-center gap-2">
                <Badge tone="neutral">{user.role.toLowerCase().replace("_", " ")}</Badge>
                {user.isSuspended ? <Badge tone="danger">suspended</Badge> : null}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
