/**
 * Zod schemas for input that crosses the client/server boundary. Web forms,
 * server actions and the mobile app all validate against the same shapes.
 */
import { z } from "zod";
import { isCountryCode } from "./countries";
import { SUPPORTED_CURRENCIES } from "./money";

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

export const PASSWORD_MIN_LENGTH = 10;
export const PASSWORD_MAX_LENGTH = 128;

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(3, "Enter your email address")
  .max(254, "Email address is too long")
  .pipe(z.email("Enter a valid email address"));

export const passwordSchema = z
  .string()
  .min(PASSWORD_MIN_LENGTH, `Use at least ${PASSWORD_MIN_LENGTH} characters`)
  .max(PASSWORD_MAX_LENGTH, `Use at most ${PASSWORD_MAX_LENGTH} characters`);

export const countryCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .refine(isCountryCode, "Choose a country");

export const currencyCodeSchema = z.enum(SUPPORTED_CURRENCIES, "Choose a supported currency");

/** Six-digit TOTP code or a recovery code (xxxxx-xxxxx). Whitespace is ignored. */
export const secondFactorCodeSchema = z
  .string()
  .transform((value) => value.replace(/\s+/g, "").toLowerCase())
  .pipe(z.string().regex(/^(\d{6}|[a-z0-9]{5}-[a-z0-9]{5})$/, "Enter the 6-digit code or a recovery code"));

export const totpCodeSchema = z
  .string()
  .transform((value) => value.replace(/\s+/g, ""))
  .pipe(z.string().regex(/^\d{6}$/, "Enter the 6-digit code from your authenticator app"));

// ---------------------------------------------------------------------------
// Authentication
// ---------------------------------------------------------------------------

export const registerSchema = z.object({
  name: z.string().trim().min(2, "Enter your name").max(80, "Name is too long"),
  email: emailSchema,
  password: passwordSchema,
});
export type RegisterInput = z.infer<typeof registerSchema>;

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, "Enter your password").max(PASSWORD_MAX_LENGTH),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const forgotPasswordSchema = z.object({ email: emailSchema });

export const resetPasswordSchema = z.object({
  token: z.string().min(20).max(200),
  password: passwordSchema,
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().max(PASSWORD_MAX_LENGTH),
  newPassword: passwordSchema,
});

// ---------------------------------------------------------------------------
// Seller onboarding
// ---------------------------------------------------------------------------

export const STORE_SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/;

/** Slugs that would collide with application routes or mislead buyers. */
export const RESERVED_STORE_SLUGS: ReadonlySet<string> = new Set([
  "admin",
  "api",
  "account",
  "seller",
  "login",
  "register",
  "support",
  "help",
  "official",
  "marketplace",
  "checkout",
  "cart",
]);

export const createStoreSchema = z.object({
  name: z.string().trim().min(3, "Store name must be at least 3 characters").max(60, "Store name is too long"),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .regex(STORE_SLUG_PATTERN, "Use 3-40 lowercase letters, numbers or hyphens")
    .refine((slug) => !RESERVED_STORE_SLUGS.has(slug), "That store address is reserved"),
  country: countryCodeSchema,
  currency: currencyCodeSchema,
  tagline: z.string().trim().max(120, "Tagline is too long").optional().default(""),
});
export type CreateStoreInput = z.infer<typeof createStoreSchema>;

export const KYC_ID_TYPES = ["passport", "national_id", "driver_license"] as const;
export type KycIdType = (typeof KYC_ID_TYPES)[number];

export const KYC_DOCUMENT_KINDS = ["id_front", "id_back", "selfie", "proof_of_address"] as const;
export type KycDocumentKind = (typeof KYC_DOCUMENT_KINDS)[number];

export const KYC_DOCUMENT_MAX_BYTES = 10 * 1024 * 1024;
export const KYC_DOCUMENT_CONTENT_TYPES = ["image/jpeg", "image/png", "image/webp", "application/pdf"] as const;
export type KycDocumentContentType = (typeof KYC_DOCUMENT_CONTENT_TYPES)[number];

export const kycDocumentSchema = z.object({
  kind: z.enum(KYC_DOCUMENT_KINDS),
  storageKey: z.string().min(10).max(300),
  fileName: z.string().min(1).max(200),
  contentType: z.enum(KYC_DOCUMENT_CONTENT_TYPES),
  size: z.number().int().positive().max(KYC_DOCUMENT_MAX_BYTES),
});
export type KycDocument = z.infer<typeof kycDocumentSchema>;

const MIN_SELLER_AGE_YEARS = 18;

export const kycSubmissionSchema = z
  .object({
    legalName: z.string().trim().min(2, "Enter your full legal name").max(120, "Name is too long"),
    birthDate: z.iso.date("Enter your date of birth"),
    country: countryCodeSchema,
    idType: z.enum(KYC_ID_TYPES, "Choose a document type"),
    idNumber: z
      .string()
      .trim()
      .min(4, "Enter the document number")
      .max(40, "Document number is too long")
      .regex(/^[A-Za-z0-9\-/ ]+$/, "Use letters, numbers, spaces, hyphens or slashes"),
    documents: z.array(kycDocumentSchema).min(2, "Upload your ID and a selfie").max(6),
  })
  .superRefine((value, ctx) => {
    const born = new Date(`${value.birthDate}T00:00:00Z`);
    const cutoff = new Date();
    cutoff.setUTCFullYear(cutoff.getUTCFullYear() - MIN_SELLER_AGE_YEARS);
    if (Number.isNaN(born.getTime()) || born > cutoff) {
      ctx.addIssue({
        code: "custom",
        path: ["birthDate"],
        message: `Sellers must be at least ${MIN_SELLER_AGE_YEARS} years old`,
      });
    }
    const kinds = new Set(value.documents.map((doc) => doc.kind));
    if (!kinds.has("id_front")) {
      ctx.addIssue({ code: "custom", path: ["documents"], message: "Upload the front of your ID document" });
    }
    if (!kinds.has("selfie")) {
      ctx.addIssue({ code: "custom", path: ["documents"], message: "Upload a selfie holding your ID" });
    }
    if (kinds.size !== value.documents.length) {
      ctx.addIssue({ code: "custom", path: ["documents"], message: "Upload each document type only once" });
    }
  });
export type KycSubmissionInput = z.infer<typeof kycSubmissionSchema>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Flatten a ZodError into `{ "field.path": "first message" }` for form display. */
export function fieldErrors(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.length > 0 ? issue.path.join(".") : "_form";
    if (!(key in out)) out[key] = issue.message;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Warehouses
// ---------------------------------------------------------------------------

export const warehouseSchema = z.object({
  name: z.string().trim().min(2, "Name this warehouse").max(60, "Name is too long"),
  line1: z.string().trim().min(3, "Enter the street address").max(120, "Address is too long"),
  line2: z.string().trim().max(120, "Address is too long"),
  city: z.string().trim().min(2, "Enter the city").max(80, "City is too long"),
  state: z.string().trim().max(80, "Region is too long"),
  postalCode: z.string().trim().max(20, "Postal code is too long"),
  country: countryCodeSchema,
});
export type WarehouseInput = z.infer<typeof warehouseSchema>;

// ---------------------------------------------------------------------------
// Exchange rates (platform setting written by the worker)
// ---------------------------------------------------------------------------

export const FX_RATES_SETTING_KEY = "fx_rates";

export const fxRatesSchema = z.object({
  base: z.literal("USD"),
  rates: z.partialRecord(currencyCodeSchema, z.number().positive()),
  fetchedAt: z.iso.datetime(),
});
