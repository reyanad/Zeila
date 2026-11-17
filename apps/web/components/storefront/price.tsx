import { convertMinor, formatMoney, type CurrencyCode, type FxRates } from "@marketplace/shared-types";
import { cn } from "@marketplace/ui";

export function formatPrice(amount: number, currency: string): string {
  return formatMoney({ amount, currency: currency as CurrencyCode });
}

export interface PriceProps {
  amount: number;
  /** Upper bound for "from" prices; omitted or equal means a single price. */
  maxAmount?: number;
  currency: string;
  viewerCurrency: string;
  fx: FxRates | null;
  className?: string;
}

/**
 * The seller's price in the seller's currency, plus an approximate amount in
 * the visitor's chosen currency when it differs and rates are available.
 */
export function Price({ amount, maxAmount, currency, viewerCurrency, fx, className }: PriceProps) {
  const ranged = maxAmount !== undefined && maxAmount !== amount;
  const converted = currency !== viewerCurrency ? convertMinor(amount, currency, viewerCurrency, fx) : null;
  return (
    <span className={cn("inline-flex flex-col", className)}>
      <span className="font-semibold tabular-nums">
        {ranged ? "From " : ""}
        {formatPrice(amount, currency)}
      </span>
      {converted !== null ? (
        <span className="text-xs text-muted-foreground tabular-nums" title="Approximate, at today's exchange rate">
          ≈ {formatPrice(converted, viewerCurrency)}
        </span>
      ) : null}
    </span>
  );
}
