"use client";

import { useState, useTransition } from "react";
import { Button } from "@marketplace/ui";
import { contactSellerAction } from "@/lib/actions/messaging";

export function ContactSellerButton({ storeId, listingId, returnTo, orderId = null, label = "Message the seller" }: {
  storeId: string;
  listingId: string | null;
  returnTo: string;
  orderId?: string | null;
  label?: string;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="flex flex-col gap-1">
      <Button
        variant="outline"
        size="sm"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            setError(null);
            const result = await contactSellerAction(storeId, listingId, returnTo, orderId);
            if (result && !result.ok) setError(result.message);
          })
        }
      >
        {pending ? "Opening…" : label}
      </Button>
      {error ? <p className="text-xs font-medium text-destructive">{error}</p> : null}
    </div>
  );
}
