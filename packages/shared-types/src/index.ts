/**
 * Shared, framework-free types and constants used by web, mobile and workers.
 * Database row types come from @marketplace/database (Prisma); these are the
 * wire-level and domain-level shapes that cross package boundaries.
 */

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

// ---------------------------------------------------------------------------
// Listings
// ---------------------------------------------------------------------------

export const LISTING_TYPES = ["PHYSICAL", "DIGITAL", "SERVICE"] as const;
export type ListingTypeValue = (typeof LISTING_TYPES)[number];

export const SERVICE_TIER_LEVELS = ["BASIC", "STANDARD", "PREMIUM"] as const;
export type ServiceTierLevelValue = (typeof SERVICE_TIER_LEVELS)[number];

export interface ListingImage {
  key: string;
  alt: string;
  position: number;
}

export interface WholesaleTierInput {
  minQty: number;
  unitPrice: MinorUnits;
}

// ---------------------------------------------------------------------------
// Cart / checkout wire shapes
// ---------------------------------------------------------------------------

export interface AddToCartInput {
  listingId: string;
  quantity: number;
  skuId?: string;
  serviceTierId?: string;
}

export interface CartTotals {
  itemsSubtotal: MinorUnits;
  shippingTotal: MinorUnits;
  taxTotal: MinorUnits;
  discountTotal: MinorUnits;
  grandTotal: MinorUnits;
  currency: CurrencyCode;
}

// ---------------------------------------------------------------------------
// API envelope
// ---------------------------------------------------------------------------

export type ApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: ApiError };

export interface ApiError {
  code: ApiErrorCode;
  message: string;
  /** Field-level validation messages, keyed by path. */
  fields?: Record<string, string>;
}

export const API_ERROR_CODES = [
  "VALIDATION",
  "UNAUTHORIZED",
  "FORBIDDEN",
  "NOT_FOUND",
  "CONFLICT",
  "RATE_LIMITED",
  "PAYMENT_REQUIRED",
  "INTERNAL",
] as const;
export type ApiErrorCode = (typeof API_ERROR_CODES)[number];

// ---------------------------------------------------------------------------
// Pagination
// ---------------------------------------------------------------------------

export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface CursorPage<T> {
  items: T[];
  nextCursor: string | null;
}

// ---------------------------------------------------------------------------
// Platform constants
// ---------------------------------------------------------------------------

export const DEFAULT_PLATFORM_FEE_BPS = 500; // 5%
export const DEFAULT_ESCROW_HOLD_DAYS = 3;
export const DEFAULT_LICENSE_ACTIVATIONS = 3;
export const ORDER_NUMBER_PREFIX = "MP";
