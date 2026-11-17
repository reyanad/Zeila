"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { SUPPORTED_CURRENCIES } from "@marketplace/shared-types";
import { setViewerCurrencyAction } from "@/lib/actions/preferences";

export function CurrencySwitcher({ current }: { current: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <label className="flex items-center gap-1 text-xs text-muted-foreground">
      <span className="sr-only">Show approximate prices in</span>
      <select
        className="rounded border border-input bg-background px-1 py-1 text-xs"
        value={current}
        disabled={pending}
        onChange={(event) => {
          const next = event.currentTarget.value;
          startTransition(async () => {
            await setViewerCurrencyAction(next);
            router.refresh();
          });
        }}
      >
        {SUPPORTED_CURRENCIES.map((code) => (
          <option key={code} value={code}>
            {code}
          </option>
        ))}
      </select>
    </label>
  );
}
