"use client";

import { useState, useTransition } from "react";
import { Alert, Button } from "@marketplace/ui";
import { placeOrderAction } from "@/lib/actions/checkout";

export function PlaceOrderButton({ currency, addressId, label }: { currency: string; addressId: string | null; label: string }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="flex flex-col gap-2">
      {error ? <Alert tone="danger">{error}</Alert> : null}
      <Button
        size="lg"
        disabled={pending}
        aria-busy={pending}
        onClick={() =>
          startTransition(async () => {
            setError(null);
            // On success the action redirects to payment; it only returns on failure.
            const result = await placeOrderAction(currency, addressId);
            if (result && !result.ok) setError(result.message);
          })
        }
      >
        {pending ? "Reserving your items…" : label}
      </Button>
    </div>
  );
}
