import Link from "next/link";
import { DEFAULT_PLATFORM_FEE_BPS } from "@marketplace/shared-types";
import { buttonVariants, Card, CardContent, CardDescription, CardHeader, CardTitle } from "@marketplace/ui";
import { getCurrentUser } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

const PILLARS = [
  {
    title: "Physical products",
    body: "Multi-warehouse inventory, variant matrices, wholesale tiers, carrier tracking and returns.",
  },
  {
    title: "Digital assets",
    body: "Encrypted storage, time-limited download links and automatic licence keys.",
  },
  {
    title: "Services and gigs",
    body: "Basic, Standard and Premium packages with milestone escrow and revision rounds.",
  },
];

export default async function HomePage() {
  const user = await getCurrentUser();
  const feePercent = (DEFAULT_PLATFORM_FEE_BPS / 100).toFixed(DEFAULT_PLATFORM_FEE_BPS % 100 === 0 ? 0 : 2);

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-10 px-4 py-14">
      <section className="flex flex-col gap-4">
        <h1 className="max-w-2xl text-4xl font-semibold tracking-tight">Buy and sell products, downloads and services in one place</h1>
        <p className="max-w-2xl text-lg text-muted-foreground">
          Payments are held in escrow and released to sellers when the order is fulfilled. Sellers keep everything except a{" "}
          {feePercent}% platform fee.
        </p>
        <div className="flex flex-wrap gap-3">
          {user ? (
            <>
              <Link href="/seller/onboarding" className={buttonVariants({ size: "lg" })}>
                {user.role === "SELLER" ? "Continue seller setup" : "Open a store"}
              </Link>
              <Link href="/account" className={buttonVariants({ variant: "outline", size: "lg" })}>
                Your account
              </Link>
            </>
          ) : (
            <>
              <Link href="/register" className={buttonVariants({ size: "lg" })}>
                Create an account
              </Link>
              <Link href="/login" className={buttonVariants({ variant: "outline", size: "lg" })}>
                Sign in
              </Link>
            </>
          )}
        </div>
      </section>

      <section aria-label="What you can sell" className="grid gap-4 md:grid-cols-3">
        {PILLARS.map((pillar) => (
          <Card key={pillar.title}>
            <CardHeader>
              <CardTitle>{pillar.title}</CardTitle>
              <CardDescription>{pillar.body}</CardDescription>
            </CardHeader>
            <CardContent />
          </Card>
        ))}
      </section>
    </div>
  );
}
