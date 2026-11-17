import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { buildQuote } from "@marketplace/core";
import { prisma } from "@marketplace/database";
import { countryOptions, isSupportedCurrency } from "@marketplace/shared-types";
import { Alert, buttonVariants, Card, CardContent, CardHeader, CardTitle } from "@marketplace/ui";
import { QuoteItems } from "@/components/cart/quote-items";
import { Totals } from "@/components/cart/totals";
import { AddressForm } from "@/components/checkout/address-form";
import { BillingCountryForm } from "@/components/checkout/billing-country-form";
import { PlaceOrderButton } from "@/components/checkout/place-order-button";
import { requireUser } from "@/lib/auth/session";
import { readCart } from "@/lib/cart-session";
import { formatPrice } from "@/components/storefront/price";

export const metadata: Metadata = { title: "Checkout", robots: { index: false } };
export const dynamic = "force-dynamic";

export default async function CheckoutPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const currency = typeof params.currency === "string" ? params.currency : "";
  const addressParam = typeof params.address === "string" ? params.address : null;
  const user = await requireUser(`/checkout?currency=${encodeURIComponent(currency)}`);
  if (!isSupportedCurrency(currency)) redirect("/cart");

  const [cart, addresses, profile] = await Promise.all([
    readCart(),
    prisma.address.findMany({ where: { userId: user.id }, orderBy: [{ isDefaultShipping: "desc" }, { updatedAt: "desc" }] }),
    prisma.user.findUnique({ where: { id: user.id }, select: { country: true } }),
  ]);
  if (!cart) redirect("/cart");

  const address = addressParam ? addresses.find((candidate) => candidate.id === addressParam) ?? null : null;
  const quote = await buildQuote({
    cart,
    currency,
    destinationCountry: address?.country ?? null,
    taxCountry: address?.country ?? profile?.country ?? null,
    buyerId: user.id,
    now: new Date(),
  });
  if (quote.stores.length === 0) redirect("/cart");

  const countries = countryOptions().map((country) => ({ value: country.code, label: country.name }));
  const needsBillingCountry = !quote.needsAddress && !profile?.country;
  const ready = (!quote.needsAddress || address !== null) && !needsBillingCountry;
  const blocking = ready ? quote.problems : quote.problems.filter((problem) => !problem.endsWith("Add a delivery address."));

  return (
    <div className="mx-auto grid w-full max-w-5xl gap-8 px-4 py-8 lg:grid-cols-[minmax(0,1fr)_22rem]">
      <div className="flex flex-col gap-6">
        <h1 className="text-2xl font-semibold tracking-tight">Checkout</h1>
        {!user.emailVerified ? (
          <Alert tone="warning" title="Confirm your email first">
            Open the confirmation link we emailed you; receipts and downloads are sent to that address.
          </Alert>
        ) : null}

        {quote.needsAddress ? (
          <Card>
            <CardHeader>
              <CardTitle>Delivery address</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              {addresses.length > 0 ? (
                <ul className="flex flex-col gap-2">
                  {addresses.map((candidate) => {
                    const selected = candidate.id === address?.id;
                    return (
                      <li key={candidate.id}>
                        <Link
                          href={`/checkout?currency=${currency}&address=${candidate.id}`}
                          aria-current={selected ? "true" : undefined}
                          className={`block rounded-md border p-3 text-sm ${selected ? "border-primary bg-accent" : "border-border hover:bg-accent"}`}
                        >
                          <span className="font-medium">{candidate.recipient}</span>
                          <span className="block text-muted-foreground">
                            {[candidate.line1, candidate.line2, candidate.city, candidate.state, candidate.country].filter(Boolean).join(", ")}
                          </span>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              ) : null}
              <details open={addresses.length === 0} className="rounded-md border border-border p-3">
                <summary className="cursor-pointer text-sm font-medium">Add a new address</summary>
                <div className="mt-4">
                  <AddressForm currency={currency} countries={countries} defaultCountry={profile?.country ?? cart.items[0]?.listing.store.country ?? "ET"} />
                </div>
              </details>
            </CardContent>
          </Card>
        ) : needsBillingCountry ? (
          <Card>
            <CardHeader>
              <CardTitle>Where are you buying from?</CardTitle>
            </CardHeader>
            <CardContent>
              <BillingCountryForm currency={currency} countries={countries} />
            </CardContent>
          </Card>
        ) : null}

        <QuoteItems quote={quote} editable={false} final={ready} />
      </div>

      <aside className="flex flex-col gap-4 self-start rounded-lg border border-border p-4 lg:sticky lg:top-6">
        <h2 className="font-medium">Order summary</h2>
        <Totals quote={quote} final={ready} />
        {blocking.length > 0 ? (
          <Alert tone="danger">
            <ul className="list-disc pl-4">
              {blocking.map((problem) => (
                <li key={problem}>{problem}</li>
              ))}
            </ul>
            <Link href="/cart" className="mt-2 inline-block font-medium underline underline-offset-4">
              Back to cart
            </Link>
          </Alert>
        ) : ready ? (
          <PlaceOrderButton
            currency={currency}
            addressId={address?.id ?? null}
            label={quote.grandTotal === 0 ? "Get it for free" : `Continue to payment · ${formatPrice(quote.grandTotal, currency)}`}
          />
        ) : (
          <p className="text-sm text-muted-foreground">{quote.needsAddress ? "Choose where to deliver." : "Choose your country."}</p>
        )}
        <p className="text-xs text-muted-foreground">
          Items are held for 30 minutes while you pay. Payments are held in escrow until delivery or approval.
        </p>
        <Link href="/cart" className={buttonVariants({ variant: "ghost", size: "sm" })}>
          Edit cart
        </Link>
      </aside>
    </div>
  );
}
