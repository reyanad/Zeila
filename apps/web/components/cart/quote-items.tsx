import Link from "next/link";
import type { Quote } from "@marketplace/core";
import { formatPrice } from "@/components/storefront/price";
import { publicAssetUrl } from "@/lib/env";
import { CartLineControls } from "./cart-line-controls";

/** Items grouped by store (each store ships and is paid separately). */
export function QuoteItems({ quote, editable, final }: { quote: Quote; editable: boolean; final: boolean }) {
  const money = (amount: number) => formatPrice(amount, quote.currency);
  return (
    <div className="flex flex-col gap-6">
      {quote.stores.map((store) => (
        <section key={store.storeId} className="flex flex-col gap-3 rounded-lg border border-border p-4" aria-label={`Items from ${store.name}`}>
          <div className="flex items-baseline justify-between gap-2">
            <h2 className="font-medium">
              <Link href={`/store/${store.slug}`} className="hover:underline">
                {store.name}
              </Link>
            </h2>
            {final && store.shipping > 0 ? <span className="text-xs text-muted-foreground">Shipping {money(store.shipping)}</span> : null}
          </div>
          {store.problem ? <p className="text-sm font-medium text-destructive">{store.problem}</p> : null}
          <ul className="flex flex-col divide-y divide-border">
            {store.items.map((item) => (
              <li key={item.id} className="flex gap-3 py-3">
                <div className="h-16 w-16 shrink-0 overflow-hidden rounded bg-muted">
                  {item.imageKey ? (
                    // eslint-disable-next-line @next/next/no-img-element -- pre-sized storage image
                    <img src={publicAssetUrl(item.imageKey)} alt="" className="h-full w-full object-cover" />
                  ) : null}
                </div>
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <Link href={`/listing/${item.slug}`} className="truncate text-sm font-medium hover:underline">
                    {item.title}
                  </Link>
                  {item.variantLabel ? <span className="text-xs text-muted-foreground">{item.variantLabel}</span> : null}
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {item.quantity} × {money(item.unitPrice)}
                    {item.unitPrice !== item.priceAtAdd && !item.problem ? " (price updated)" : ""}
                  </span>
                  {item.flash ? (
                    <span className="text-xs font-medium text-destructive">
                      {item.flash.name}: {Math.round(item.flash.discountBps / 100)}% off until {new Date(item.flash.endsAt).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}
                    </span>
                  ) : null}
                  {item.problem ? <span className="text-xs font-medium text-destructive">{item.problem}</span> : null}
                </div>
                <div className="flex flex-col items-end gap-1">
                  <span className="text-sm font-medium tabular-nums">{money(item.lineTotal)}</span>
                  {item.discount > 0 ? <span className="text-xs text-green-700 tabular-nums">−{money(item.discount)}</span> : null}
                  {editable ? (
                    <CartLineControls itemId={item.id} quantity={item.quantity} maxQuantity={item.maxQuantity} adjustable={item.type === "PHYSICAL"} label={item.title} />
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
