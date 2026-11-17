"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button, Input } from "@marketplace/ui";
import { removeCartItemAction, updateCartItemAction } from "@/lib/actions/cart";

export function CartLineControls({ itemId, quantity, maxQuantity, adjustable, label }: {
  itemId: string;
  quantity: number;
  maxQuantity: number;
  adjustable: boolean;
  label: string;
}) {
  const router = useRouter();
  const [value, setValue] = useState(String(quantity));
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const run = (work: () => Promise<{ ok: boolean; message?: string }>) =>
    startTransition(async () => {
      setError(null);
      const result = await work();
      if (!result.ok) setError(result.message ?? "That did not work.");
      router.refresh();
    });

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex items-center gap-2">
        {adjustable ? (
          <>
            <Input
              aria-label={`Quantity of ${label}`}
              inputMode="numeric"
              className="h-9 w-16"
              value={value}
              onChange={(event) => setValue(event.currentTarget.value.replace(/[^\d]/g, "").slice(0, 4))}
            />
            <Button
              size="sm"
              variant="outline"
              disabled={pending || value === String(quantity) || value === ""}
              onClick={() => run(() => updateCartItemAction(itemId, Number(value)))}
            >
              Update
            </Button>
          </>
        ) : null}
        <Button size="sm" variant="ghost" disabled={pending} onClick={() => run(() => removeCartItemAction(itemId))} aria-label={`Remove ${label}`}>
          Remove
        </Button>
      </div>
      {adjustable && maxQuantity > 0 ? <span className="text-xs text-muted-foreground">{maxQuantity} available</span> : null}
      {error ? (
        <p role="alert" className="text-xs font-medium text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
