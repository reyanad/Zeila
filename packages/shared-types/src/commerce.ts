/**
 * Cart, checkout, shipping and tax shapes shared by web, worker and mobile.
 * All amounts are integer minor units in the relevant store's currency.
 */
import { z } from "zod";
import { countryCodeSchema } from "./validation";
import { priceSchema } from "./listing";

// ---------------------------------------------------------------------------
// Shipping
// ---------------------------------------------------------------------------

export const shippingRateSchema = z.object({
  /** Charged per order for the first kilogram. */
  base: priceSchema,
  /** Each additional started kilogram. */
  perKg: priceSchema,
});

export const shippingProfileSchema = z.object({
  domestic: shippingRateSchema,
  /** null: the store does not ship abroad. */
  international: shippingRateSchema.nullable(),
  /** Free domestic shipping when the store's items total at least this (after discounts). */
  freeOverDomestic: priceSchema.nullable(),
  handlingDays: z.number().int().min(0, "Handling time cannot be negative").max(30, "At most 30 days"),
});
export type ShippingProfile = z.infer<typeof shippingProfileSchema>;

/** Weight assumed for a variant that has none set. */
export const DEFAULT_ITEM_WEIGHT_GRAMS = 500;

// ---------------------------------------------------------------------------
// Tax (platform setting `tax_rates`, configured by administrators)
// ---------------------------------------------------------------------------

export const TAX_RATES_SETTING_KEY = "tax_rates";

export const taxRuleSchema = z.object({
  /** Rate in basis points: 1500 = 15%. */
  bps: z.number().int().min(0).max(5_000),
  physical: z.boolean(),
  digital: z.boolean(),
  service: z.boolean(),
  shippingTaxable: z.boolean(),
  /** Label shown to buyers, e.g. "VAT". */
  label: z.string().trim().min(1).max(20),
});
export type TaxRule = z.infer<typeof taxRuleSchema>;

/** Destination country -> rule. Countries without a rule are not taxed. */
export const taxRatesSchema = z.record(z.string().regex(/^[A-Z]{2}$/), taxRuleSchema);
export type TaxRates = z.infer<typeof taxRatesSchema>;

// ---------------------------------------------------------------------------
// Cart
// ---------------------------------------------------------------------------

export const MAX_CART_QUANTITY = 9_999;

export const addToCartSchema = z
  .object({
    listingId: z.string().min(1).max(40),
    skuId: z.string().min(1).max(40).optional(),
    serviceTierId: z.string().min(1).max(40).optional(),
    quantity: z.number().int().min(1, "Choose at least one").max(MAX_CART_QUANTITY),
  })
  .refine((value) => !(value.skuId && value.serviceTierId), "Choose a variant or a package, not both");
export type AddToCartPayload = z.infer<typeof addToCartSchema>;

export const promoCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9-]{3,32}$/, "Enter a valid code");

// ---------------------------------------------------------------------------
// Addresses
// ---------------------------------------------------------------------------

export const addressSchema = z.object({
  recipient: z.string().trim().min(2, "Enter the recipient's name").max(80, "Name is too long"),
  phone: z
    .string()
    .trim()
    .min(7, "Enter a phone number the courier can call")
    .max(20, "Phone number is too long")
    .regex(/^\+?[0-9 ()-]+$/, "Use digits, spaces and an optional +"),
  line1: z.string().trim().min(3, "Enter the street address").max(120, "Address is too long"),
  line2: z.string().trim().max(120, "Address is too long"),
  city: z.string().trim().min(2, "Enter the city").max(80, "City is too long"),
  state: z.string().trim().max(80, "Region is too long"),
  postalCode: z.string().trim().max(20, "Postal code is too long"),
  country: countryCodeSchema,
});
export type AddressInput = z.infer<typeof addressSchema>;

/** Immutable copy of the delivery address stored on an order. */
export interface AddressSnapshot extends AddressInput {
  addressId: string | null;
}

export const CHECKOUT_HOLD_MINUTES = 30;
