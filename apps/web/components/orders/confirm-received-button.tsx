"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@marketplace/ui";
import { confirmReceivedAction } from "@/lib/actions/orders";

export function ConfirmReceivedButton({ orderId, subOrderId, storeName }: { orderId: string; subOrderId: string; storeName: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  if (!confirming) {
    return (
      <Button size="sm" variant="outline" onClick={() => setConfirming(true)}>
        I received it
      </Button>
    );
  }
  return (
    <div className="flex flex-col gap-2 rounded-md border border-border p-3 text-sm">
      <p>Confirm everything from {storeName} arrived as described? {storeName} will be paid right away and this cannot be undone.</p>
      <div className="flex gap-2">
        <Button
          size="sm"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              const result = await confirmReceivedAction(orderId, subOrderId);
              if (!result.ok) setError(result.message);
              else router.refresh();
            })
          }
        >
          {pending ? "Confirming…" : "Yes, release payment"}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setConfirming(false)} disabled={pending}>
          Not yet
        </Button>
      </div>
      {error ? <p className="text-xs font-medium text-destructive">{error}</p> : null}
    </div>
  );
}
