"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { FxRates } from "@marketplace/shared-types";
import { Button } from "@marketplace/ui";
import { addToCartAction } from "@/lib/actions/cart";
import { PurchasePanel, type PurchaseData, type PurchaseSelection } from "./purchase-panel";

function AddToCart({ listingId, selection }: { listingId: string; selection: PurchaseSelection | null }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  const add = () =>
    startTransition(async () => {
      if (!selection) return;
      const response = await addToCartAction({
        listingId,
        skuId: selection.skuId,
        serviceTierId: selection.serviceTierId,
        quantity: selection.quantity,
      });
      setResult({ ok: response.ok, message: response.message ?? "Added to your cart." });
      if (response.ok) router.refresh();
    });

  return (
    <div className="flex flex-col gap-2">
      <Button size="lg" onClick={add} disabled={!selection || pending} aria-busy={pending}>
        {pending ? "Adding…" : selection ? "Add to cart" : "Unavailable"}
      </Button>
      {result ? (
        <p role="status" className={result.ok ? "text-sm" : "text-sm font-medium text-destructive"}>
          {result.message}{" "}
          {result.ok ? (
            <Link href="/cart" className="font-medium underline underline-offset-4">
              View cart
            </Link>
          ) : null}
        </p>
      ) : null}
    </div>
  );
}

/** Purchase panel with add-to-cart; a client wrapper because the panel's action is a render prop. */
export function ListingPurchase({ listingId, data, viewerCurrency, fx }: { listingId: string; data: PurchaseData; viewerCurrency: string; fx: FxRates | null }) {
  return (
    <PurchasePanel data={data} viewerCurrency={viewerCurrency} fx={fx} renderAction={(selection) => <AddToCart listingId={listingId} selection={selection} />} />
  );
}
