import Link from "next/link";
import type { ReactNode } from "react";
import { hasPermission, STAFF_ROLES, type Permission } from "@marketplace/shared-types";
import { requireRole } from "@/lib/auth/session";

const SECTIONS: Array<{ href: string; label: string; permission: Permission | null }> = [
  { href: "/admin", label: "Overview", permission: null },
  { href: "/admin/kyc", label: "Identity checks", permission: "kyc:review" },
  { href: "/admin/listings", label: "Listings", permission: "listing:moderate" },
  { href: "/admin/reviews", label: "Reviews", permission: "review:moderate" },
  { href: "/admin/disputes", label: "Cases", permission: "dispute:resolve" },
  { href: "/admin/fraud", label: "Fraud", permission: "fraud:review" },
  { href: "/admin/users", label: "Users", permission: "user:suspend" },
  { href: "/admin/ledger", label: "Ledger", permission: "ledger:reconcile" },
  { href: "/admin/settings", label: "Settings", permission: "platform:configure" },
  { href: "/admin/audit", label: "Audit log", permission: "audit:view" },
];

/** Staff-only shell: every page and action below re-checks its own permission. */
export default async function AdminLayout({ children }: { children: ReactNode }) {
  const user = await requireRole(STAFF_ROLES, "/admin");
  const sections = SECTIONS.filter((section) => section.permission === null || hasPermission(user.role, section.permission));
  return (
    <div className="flex flex-col">
      <nav aria-label="Admin" className="border-b border-border bg-muted/40">
        <ul className="mx-auto flex w-full max-w-6xl flex-wrap gap-x-4 gap-y-1 px-4 py-2 text-sm">
          {sections.map((section) => (
            <li key={section.href}>
              <Link href={section.href} className="text-muted-foreground hover:text-foreground">
                {section.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      {children}
    </div>
  );
}
