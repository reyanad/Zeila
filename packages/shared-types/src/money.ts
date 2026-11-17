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

/** Largest price accepted anywhere: 10,000,000.00 in major units. */
export const MAX_PRICE_MINOR: MinorUnits = 1_000_000_000;

/**
 * Parse a price typed by a person ("12", "12.5", "1,299.99") into minor
 * units without floating point. Returns null for anything that is not a
 * non-negative amount with at most two decimals.
 */
export function parseMoneyInput(input: string): MinorUnits | null {
  const cleaned = input.trim().replace(/[,\s]/g, "");
  const match = /^(\d{1,10})(?:\.(\d{1,2}))?$/.exec(cleaned);
  if (!match) return null;
  const whole = Number(match[1]);
  const fraction = Number((match[2] ?? "").padEnd(2, "0"));
  const minor = whole * 100 + fraction;
  return minor <= MAX_PRICE_MINOR ? minor : null;
}

/** Minor units to an editable string: 1250 -> "12.50", 1200 -> "12". */
export function minorToInput(amount: MinorUnits): string {
  const whole = Math.trunc(amount / 100);
  const fraction = Math.abs(amount % 100);
  return fraction === 0 ? String(whole) : `${whole}.${String(fraction).padStart(2, "0")}`;
}

/**
 * Exchange rates as units of each currency per 1 USD, e.g. { USD: 1, ETB: 155.4 }.
 * Fetched by the worker and stored as a platform setting; never hard-coded.
 */
export interface FxRates {
  base: "USD";
  rates: Partial<Record<CurrencyCode, number>>;
  fetchedAt: string;
}

/** Convert minor units between currencies; null when either rate is unknown. */
export function convertMinor(amount: MinorUnits, from: string, to: string, fx: FxRates | null): MinorUnits | null {
  if (from === to) return amount;
  if (!fx) return null;
  const fromRate = fx.rates[from as CurrencyCode];
  const toRate = fx.rates[to as CurrencyCode];
  if (!fromRate || !toRate || fromRate <= 0 || toRate <= 0) return null;
  return Math.round((amount / fromRate) * toRate);
}

export function isSupportedCurrency(value: string): value is CurrencyCode {
  return (SUPPORTED_CURRENCIES as readonly string[]).includes(value);
}
