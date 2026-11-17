// ---------------------------------------------------------------------------
// Money
// ---------------------------------------------------------------------------

/** Amount in minor units (cents). Never use floats for money. */
export type MinorUnits = number;

export const SUPPORTED_CURRENCIES = ["USD", "EUR", "GBP", "ETB", "KES", "NGN", "AED", "INR"] as const;
export type CurrencyCode = (typeof SUPPORTED_CURRENCIES)[number];

/** Currencies whose minor unit is not 1/100 (none supported yet, kept for growth). */
export const ZERO_DECIMAL_CURRENCIES: ReadonlySet<string> = new Set(["JPY", "KRW"]);

export interface Money {
  amount: MinorUnits;
  currency: CurrencyCode;
}

export function formatMoney(money: Money, locale = "en-US"): string {
  const divisor = ZERO_DECIMAL_CURRENCIES.has(money.currency) ? 1 : 100;
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: money.currency,
  }).format(money.amount / divisor);
}

/** Basis points helper: applyBps(10_000, 500) === 500 (5% of 100.00). */
export function applyBps(amount: MinorUnits, bps: number): MinorUnits {
  return Math.round((amount * bps) / 10_000);
}
