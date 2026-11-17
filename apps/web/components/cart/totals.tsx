import type { Quote } from "@marketplace/core";
import { formatPrice } from "@/components/storefront/price";

/** Order totals for a quote; shipping and tax show as pending until there is an address. */
export function Totals({ quote, final }: { quote: Quote; final: boolean }) {
  const money = (amount: number) => formatPrice(amount, quote.currency);
  return (
    <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 text-sm">
      <dt>Items</dt>
      <dd className="text-right tabular-nums">{money(quote.itemsSubtotal)}</dd>
      {quote.discountTotal > 0 ? (
        <>
          <dt>Discount</dt>
          <dd className="text-right tabular-nums text-green-700">−{money(quote.discountTotal)}</dd>
        </>
      ) : null}
      {quote.needsAddress ? (
        <>
          <dt>Shipping</dt>
          <dd className="text-right tabular-nums">{final ? money(quote.shippingTotal) : "At checkout"}</dd>
        </>
      ) : null}
      <dt>{quote.taxLabel ?? "Tax"}</dt>
      <dd className="text-right tabular-nums">{final ? money(quote.taxTotal) : "At checkout"}</dd>
      <dt className="border-t border-border pt-2 font-semibold">Total</dt>
      <dd className="border-t border-border pt-2 text-right font-semibold tabular-nums">
        {final ? money(quote.grandTotal) : money(quote.itemsSubtotal - quote.discountTotal)}
      </dd>
    </dl>
  );
}
