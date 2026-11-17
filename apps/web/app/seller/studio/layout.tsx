import type { ReactNode } from "react";
import Link from "next/link";
import { requireStudio } from "@/lib/studio/context";

export const dynamic = "force-dynamic";

const LINKS = [
  { href: "/seller/studio", label: "Listings" },
  { href: "/seller/studio/orders", label: "Orders" },
  { href: "/seller/studio/warehouses", label: "Warehouses" },
  { href: "/seller/studio/shipping", label: "Shipping" },
  { href: "/seller/onboarding", label: "Seller setup" },
];

export default async function StudioLayout({ children }: { children: ReactNode }) {
  const { store } = await requireStudio("/seller/studio");
  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-8">
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border pb-4">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Vendor Studio</p>
          <p className="text-lg font-semibold">{store.name}</p>
        </div>
        <nav aria-label="Vendor Studio" className="flex gap-1">
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
      </div>
      {children}
    </div>
  );
}
