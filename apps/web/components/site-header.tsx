import Link from "next/link";
import { isStaff } from "@marketplace/shared-types";
import { buttonVariants } from "@marketplace/ui";
import { SignOutButton } from "@/components/auth/sign-out-button";
import { getCurrentUser } from "@/lib/auth/session";

const navLink = "text-sm font-medium text-muted-foreground transition-colors hover:text-foreground";

export async function SiteHeader() {
  const user = await getCurrentUser();

  return (
    <header className="border-b border-border bg-card">
      <div className="mx-auto flex h-14 w-full max-w-5xl items-center justify-between gap-4 px-4">
        <Link href="/" className="text-base font-semibold tracking-tight">
          Marketplace
        </Link>
        <nav aria-label="Main" className="flex items-center gap-4">
          {user ? (
            <>
              {isStaff(user.role) ? (
                <Link href="/admin" className={navLink}>
                  Admin
                </Link>
              ) : null}
              <Link href="/seller/onboarding" className={navLink}>
                {user.role === "SELLER" ? "Seller setup" : "Sell"}
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
