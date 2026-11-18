/**
 * Shared, framework-free types and constants used by web, mobile and workers.
 * Database row types come from @marketplace/database (Prisma); these are the
 * wire-level and domain-level shapes that cross package boundaries.
 */

import type { CurrencyCode, MinorUnits } from "./money";

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

export const APP_NAME = "Zeila";
export const DEFAULT_PLATFORM_FEE_BPS = 500; // 5%
export const DEFAULT_ESCROW_HOLD_DAYS = 3;
export const DEFAULT_LICENSE_ACTIVATIONS = 3;
export const ORDER_NUMBER_PREFIX = "MP";

// ---------------------------------------------------------------------------
// Re-exports
// ---------------------------------------------------------------------------

export * from "./commerce";
export * from "./countries";
export * from "./fulfilment";
export * from "./messaging";
export * from "./listing";
export * from "./money";
export * from "./rbac";
export * from "./validation";
