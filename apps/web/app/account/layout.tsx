import type { ReactNode } from "react";
import Link from "next/link";
import { requireUser } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

const LINKS = [
  { href: "/account", label: "Overview" },
  { href: "/account/security", label: "Security" },
  { href: "/seller/onboarding", label: "Selling" },
];

export default async function AccountLayout({ children }: { children: ReactNode }) {
  await requireUser("/account");

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-8 px-4 py-10 md:flex-row">
      <nav aria-label="Account" className="flex shrink-0 gap-2 md:w-48 md:flex-col">
        {LINKS.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            className="rounded-md px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
          >
            {link.label}
          </Link>
        ))}
      </nav>
      <div className="flex min-w-0 flex-1 flex-col gap-6">{children}</div>
    </div>
  );
}
