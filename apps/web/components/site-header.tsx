import Link from "next/link";
import { isStaff } from "@marketplace/shared-types";
import { buttonVariants } from "@marketplace/ui";
import { SignOutButton } from "@/components/auth/sign-out-button";
import { CurrencySwitcher } from "@/components/storefront/currency-switcher";
import { getCurrentUser } from "@/lib/auth/session";
import { readCartCount } from "@/lib/cart-session";
import { getViewerCurrency } from "@/lib/storefront/fx";

const navLink = "text-sm font-medium text-muted-foreground transition-colors hover:text-foreground";

export async function SiteHeader() {
  const [user, currency, cartCount] = await Promise.all([getCurrentUser(), getViewerCurrency(), readCartCount()]);

  return (
    <header className="border-b border-border bg-card">
      <div className="mx-auto flex h-14 w-full max-w-5xl items-center justify-between gap-4 px-4">
        <Link href="/" className="text-base font-semibold tracking-tight">
          Marketplace
        </Link>
        <form action="/search" role="search" className="hidden flex-1 md:block">
          <label htmlFor="header-search" className="sr-only">
            Search the marketplace
          </label>
          <input
            id="header-search"
            name="q"
            type="search"
            placeholder="Search products, downloads and services"
            className="h-9 w-full max-w-md rounded-md border border-input bg-background px-3 text-sm"
          />
        </form>
        <nav aria-label="Main" className="flex items-center gap-4">
          <CurrencySwitcher current={currency} />
          <Link href="/cart" className={navLink} aria-label={`Cart, ${cartCount} item${cartCount === 1 ? "" : "s"}`}>
            Cart{cartCount > 0 ? <span className="ml-1 rounded-full bg-primary px-1.5 py-0.5 text-xs text-primary-foreground">{cartCount}</span> : null}
          </Link>
          {user ? (
            <>
              {isStaff(user.role) ? (
                <Link href="/admin" className={navLink}>
                  Admin
                </Link>
              ) : null}
              {user.role === "SELLER" || user.role === "SUPER_ADMIN" ? (
                <Link href="/seller/studio" className={navLink}>
                  Studio
                </Link>
              ) : (
                <Link href="/seller/onboarding" className={navLink}>
                  Sell
                </Link>
              )}
              <Link href="/orders" className={navLink}>
                Orders
              </Link>
              <Link href="/account" className={navLink}>
                Account
              </Link>
              <SignOutButton />
            </>
          ) : (
            <>
              <Link href="/login" className={navLink}>
                Sign in
              </Link>
              <Link href="/register" className={buttonVariants({ size: "sm" })}>
                Create account
              </Link>
            </>
          )}
        </nav>
      </div>
    </header>
  );
}
