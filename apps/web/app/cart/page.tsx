import type { Metadata } from "next";
import Link from "next/link";
import { buildQuote, cartCurrencies } from "@marketplace/core";
import { buttonVariants } from "@marketplace/ui";
import { PromoForm } from "@/components/cart/promo-form";
import { QuoteItems } from "@/components/cart/quote-items";
import { Totals } from "@/components/cart/totals";
import { getCurrentUser } from "@/lib/auth/session";
import { readCart } from "@/lib/cart-session";

export const metadata: Metadata = { title: "Your cart", robots: { index: false } };
export const dynamic = "force-dynamic";

export default async function CartPage() {
  const [cart, user] = await Promise.all([readCart(), getCurrentUser()]);
  const currencies = cart ? cartCurrencies(cart) : [];

  if (!cart || currencies.length === 0) {
    return (
      <div className="mx-auto flex w-full max-w-3xl flex-col items-center gap-4 px-4 py-20 text-center">
        <h1 className="text-2xl font-semibold tracking-tight">Your cart is empty</h1>
        <p className="text-muted-foreground">Products, downloads and services can all go in one cart.</p>
        <Link href="/" className={buttonVariants()}>
          Start shopping
        </Link>
      </div>
    );
  }

  const quotes = await Promise.all(
    currencies.map((currency) => buildQuote({ cart, currency, destinationCountry: null, taxCountry: null, buyerId: user?.id ?? null, now: new Date() })),
  );

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-8 px-4 py-8">
      <h1 className="text-2xl font-semibold tracking-tight">Your cart</h1>
      {quotes.length > 1 ? (
        <p className="rounded-md bg-muted px-4 py-3 text-sm">
          Your cart has items priced in {currencies.join(" and ")}. Each currency is paid in a separate checkout.
        </p>
      ) : null}
      {quotes.map((quote) => (
        <div key={quote.currency} className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
          <QuoteItems quote={quote} editable final={false} />
          <aside className="flex flex-col gap-4 self-start rounded-lg border border-border p-4">
            <h2 className="font-medium">Summary ({quote.currency})</h2>
            <PromoForm current={quote.promo} />
            <Totals quote={quote} final={false} />
            {quote.problems.length > 0 ? (
              <p className="text-xs font-medium text-destructive">Fix the items marked above to continue.</p>
            ) : (
              <Link href={`/checkout?currency=${quote.currency}`} className={buttonVariants({ size: "lg" })}>
                Checkout
              </Link>
            )}
            <p className="text-xs text-muted-foreground">Your payment is held safely and released to sellers only after delivery.</p>
          </aside>
        </div>
      ))}
    </div>
  );
}
