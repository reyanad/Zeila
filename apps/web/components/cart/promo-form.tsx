"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button, Input } from "@marketplace/ui";
import { applyPromoAction, removePromoAction } from "@/lib/actions/cart";

export function PromoForm({ current }: { current: { code: string; applied: boolean; problem: string | null } | null }) {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (current) {
    return (
      <div className="flex flex-col gap-1 text-sm">
        <div className="flex items-center justify-between gap-2">
          <span>
            Code <span className="font-mono font-medium">{current.code}</span> {current.applied ? "applied" : "not applied"}
          </span>
          <Button
            size="sm"
            variant="ghost"
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                await removePromoAction();
                router.refresh();
              })
            }
          >
            Remove
          </Button>
        </div>
        {current.problem ? <p className="text-xs font-medium text-destructive">{current.problem}</p> : null}
      </div>
    );
  }

  return (
    <form
      className="flex flex-col gap-1"
      onSubmit={(event) => {
        event.preventDefault();
        startTransition(async () => {
          setError(null);
          const result = await applyPromoAction(code);
          if (!result.ok) setError(result.message);
          else setCode("");
          router.refresh();
        });
      }}
    >
      <label htmlFor="promo" className="text-sm font-medium">
        Promo code
      </label>
      <div className="flex gap-2">
        <Input id="promo" value={code} onChange={(event) => setCode(event.currentTarget.value.toUpperCase())} maxLength={32} className="h-9" />
        <Button type="submit" size="sm" variant="outline" disabled={pending || code.trim().length < 3}>
          Apply
        </Button>
      </div>
      {error ? <p className="text-xs font-medium text-destructive">{error}</p> : null}
    </form>
  );
}
