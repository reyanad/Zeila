/**
 * Polymorphic listing input: one schema per listing type, discriminated by
 * `type`. The Vendor Studio, server actions and the mobile app validate the
 * same shapes. Prices are integer minor units.
 *
 * Two levels of strictness:
 *  - `listingInputSchema` accepts any well-formed draft (missing pieces allowed)
 *  - `publishIssues()` lists what still blocks publishing
 */
import { z } from "zod";
import { MAX_PRICE_MINOR } from "./money";

const SERVICE_LEVELS = ["BASIC", "STANDARD", "PREMIUM"] as const;

export const LISTING_LIMITS = {
  titleMax: 140,
  summaryMax: 280,
  descriptionMax: 20_000,
  tagsMax: 15,
  imagesMax: 8,
  variantAxesMax: 3,
  variantValuesMax: 20,
  skusMax: 200,
  wholesaleTiersMax: 5,
  serviceFeaturesMax: 10,
  intakeFieldsMax: 20,
} as const;

export const priceSchema = z
  .number("Enter a price")
  .int("Prices are whole minor units")
  .min(0, "Price cannot be negative")
  .max(MAX_PRICE_MINOR, "Price is too high");

const nonNegativeInt = (max: number, label: string) =>
  z.number(`Enter ${label}`).int(`${label} must be a whole number`).min(0, `${label} cannot be negative`).max(max, `${label} is too large`);

export const LISTING_IMAGE_KEY_PATTERN = /^listing-images\/[a-z0-9]{8,40}\/[a-z0-9]{16,64}\.webp$/;

export const listingImageSchema = z.object({
  key: z.string().regex(LISTING_IMAGE_KEY_PATTERN, "Unknown image"),
  alt: z.string().trim().max(200, "Alt text is too long"),
  position: z.number().int().min(0),
});
export type ListingImageInput = z.infer<typeof listingImageSchema>;

const baseFields = {
  title: z.string().trim().min(3, "Title must be at least 3 characters").max(LISTING_LIMITS.titleMax, "Title is too long"),
  summary: z.string().trim().max(LISTING_LIMITS.summaryMax, "Summary is too long"),
  description: z.string().trim().max(LISTING_LIMITS.descriptionMax, "Description is too long"),
  categoryId: z.string().min(1).max(40).nullable(),
  tags: z
    .array(z.string().trim().toLowerCase().min(1).max(30, "Tags are at most 30 characters"))
    .max(LISTING_LIMITS.tagsMax, `Use at most ${LISTING_LIMITS.tagsMax} tags`),
  images: z.array(listingImageSchema).max(LISTING_LIMITS.imagesMax, `Use at most ${LISTING_LIMITS.imagesMax} images`),
};

// ---------------------------------------------------------------------------
// Physical
// ---------------------------------------------------------------------------

export const variantAxisSchema = z.object({
  name: z.string().trim().min(1, "Name the option, e.g. Size").max(30, "Option name is too long"),
  values: z
    .array(z.string().trim().min(1).max(40, "Option values are at most 40 characters"))
    .min(1, "Add at least one value")
    .max(LISTING_LIMITS.variantValuesMax, `Use at most ${LISTING_LIMITS.variantValuesMax} values`),
});
export type VariantAxis = z.infer<typeof variantAxisSchema>;

export const stockLevelSchema = z.object({
  warehouseId: z.string().min(1).max(40),
  onHand: nonNegativeInt(10_000_000, "Stock"),
});

export const skuInputSchema = z.object({
  id: z.string().min(1).max(40).nullable(),
  skuCode: z
    .string()
    .trim()
    .min(1, "Enter a SKU code")
    .max(64, "SKU code is too long")
    .regex(/^[A-Za-z0-9._-]+$/, "Use letters, numbers, dots, dashes or underscores"),
  variantValues: z.record(z.string(), z.string()),
  price: priceSchema,
  compareAtPrice: priceSchema.nullable(),
  barcode: z.string().trim().max(32, "Barcode is too long").nullable(),
  weightGrams: nonNegativeInt(1_000_000, "Weight").nullable(),
  isActive: z.boolean(),
  stock: z.array(stockLevelSchema).max(20),
});
export type SkuInput = z.infer<typeof skuInputSchema>;

/** Volume discount applied to every SKU: buy at least `minQty`, save `discountBps`. */
export const wholesaleTierInputSchema = z.object({
  minQty: z.number("Enter a quantity").int().min(2, "Wholesale tiers start at 2 units").max(1_000_000),
  discountBps: z.number("Enter a discount").int().min(1, "Discount must be above 0%").max(9_000, "Discount is at most 90%"),
});
export type WholesaleTierDraft = z.infer<typeof wholesaleTierInputSchema>;

export const physicalListingSchema = z
  .object({
    type: z.literal("PHYSICAL"),
    ...baseFields,
    variantAxes: z.array(variantAxisSchema).max(LISTING_LIMITS.variantAxesMax, "Use at most three options"),
    skus: z.array(skuInputSchema).max(LISTING_LIMITS.skusMax, "Too many variants"),
    wholesaleTiers: z.array(wholesaleTierInputSchema).max(LISTING_LIMITS.wholesaleTiersMax),
  })
  .superRefine((value, ctx) => {
    const axisNames = value.variantAxes.map((axis) => axis.name.toLowerCase());
    if (new Set(axisNames).size !== axisNames.length) {
      ctx.addIssue({ code: "custom", path: ["variantAxes"], message: "Option names must be different" });
    }
    const codes = new Set<string>();
    value.skus.forEach((sku, index) => {
      const code = sku.skuCode.toUpperCase();
      if (codes.has(code)) ctx.addIssue({ code: "custom", path: ["skus", index, "skuCode"], message: "SKU codes must be unique" });
      codes.add(code);
      if (sku.compareAtPrice !== null && sku.compareAtPrice <= sku.price) {
        ctx.addIssue({ code: "custom", path: ["skus", index, "compareAtPrice"], message: "Compare-at price must be higher than the price" });
      }
      for (const axis of value.variantAxes) {
        const chosen = sku.variantValues[axis.name];
        if (chosen === undefined || !axis.values.includes(chosen)) {
          ctx.addIssue({ code: "custom", path: ["skus", index, "variantValues"], message: `Choose a ${axis.name}` });
        }
      }
      const warehouses = new Set(sku.stock.map((level) => level.warehouseId));
      if (warehouses.size !== sku.stock.length) {
        ctx.addIssue({ code: "custom", path: ["skus", index, "stock"], message: "Each warehouse once per SKU" });
      }
    });
    const combos = new Set(value.skus.map((sku) => value.variantAxes.map((axis) => sku.variantValues[axis.name] ?? "").join("\u0000")));
    if (value.variantAxes.length > 0 && combos.size !== value.skus.length) {
      ctx.addIssue({ code: "custom", path: ["skus"], message: "Each combination of options can appear only once" });
    }
    for (let index = 1; index < value.wholesaleTiers.length; index += 1) {
      const previous = value.wholesaleTiers[index - 1];
      const current = value.wholesaleTiers[index];
      if (previous && current && (current.minQty <= previous.minQty || current.discountBps <= previous.discountBps)) {
        ctx.addIssue({
          code: "custom",
          path: ["wholesaleTiers", index],
          message: "Each tier needs a larger quantity and a bigger discount than the one before",
        });
      }
    }
  });

// ---------------------------------------------------------------------------
// Digital
// ---------------------------------------------------------------------------

/** Reference to a file already streamed into the vault, signed by the server. */
export const digitalAssetRefSchema = z.object({
  vaultKey: z.string().min(10).max(300),
  fileName: z.string().min(1).max(200),
  sizeBytes: z.number().int().positive(),
  checksumSha256: z.string().regex(/^[a-f0-9]{64}$/),
  /** Server signature over the fields above; required when the file is new. */
  token: z.string().max(2048).nullable(),
});
export type DigitalAssetRef = z.infer<typeof digitalAssetRefSchema>;

export const LICENSE_PREFIX_PATTERN = /^[A-Z0-9]{2,10}$/;

export const digitalListingSchema = z.object({
  type: z.literal("DIGITAL"),
  ...baseFields,
  price: priceSchema,
  asset: digitalAssetRefSchema.nullable(),
  version: z
    .string()
    .trim()
    .regex(/^\d{1,4}(\.\d{1,4}){0,3}$/, "Use a version like 1.0 or 2.3.1"),
  changelog: z.string().trim().max(5_000, "Changelog is too long"),
  licenseKeys: z.boolean(),
  licensePrefix: z
    .string()
    .trim()
    .toUpperCase()
    .regex(LICENSE_PREFIX_PATTERN, "Use 2-10 letters or digits")
    .nullable(),
  activationsLimit: z.number("Enter a number").int().min(1, "At least one activation").max(100, "At most 100 activations"),
  downloadLimit: z.number("Enter a number").int().min(1, "At least one download").max(1_000).nullable(),
});

// ---------------------------------------------------------------------------
// Services
// ---------------------------------------------------------------------------

export const serviceTierInputSchema = z.object({
  level: z.enum(SERVICE_LEVELS),
  title: z.string().trim().min(2, "Name this package").max(60, "Package name is too long"),
  description: z.string().trim().min(10, "Describe what is included").max(600, "Description is too long"),
  price: priceSchema.min(100, "Packages cost at least 1.00"),
  deliveryDays: z.number("Enter days").int().min(1, "At least one day").max(365, "At most 365 days"),
  /** Included revision rounds; -1 means unlimited. */
  revisions: z.number("Enter revisions").int().min(-1).max(50, "At most 50 revisions"),
  features: z
    .array(z.string().trim().min(1).max(80, "Keep each feature under 80 characters"))
    .max(LISTING_LIMITS.serviceFeaturesMax, `Use at most ${LISTING_LIMITS.serviceFeaturesMax} features`),
});
export type ServiceTierInput = z.infer<typeof serviceTierInputSchema>;

export const INTAKE_FIELD_KINDS = ["text", "textarea", "select", "file", "url"] as const;
export type IntakeFieldKind = (typeof INTAKE_FIELD_KINDS)[number];

export const intakeFieldSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9_-]{1,40}$/),
    label: z.string().trim().min(2, "Write the question").max(200, "Question is too long"),
    kind: z.enum(INTAKE_FIELD_KINDS),
    required: z.boolean(),
    options: z.array(z.string().trim().min(1).max(80)).max(20),
  })
  .superRefine((field, ctx) => {
    if (field.kind === "select" && field.options.length < 2) {
      ctx.addIssue({ code: "custom", path: ["options"], message: "A choice question needs at least two options" });
    }
  });
export type IntakeField = z.infer<typeof intakeFieldSchema>;

export const serviceListingSchema = z
  .object({
    type: z.literal("SERVICE"),
    ...baseFields,
    tiers: z.array(serviceTierInputSchema).min(1, "Add at least the Basic package").max(3),
    intakeFields: z.array(intakeFieldSchema).max(LISTING_LIMITS.intakeFieldsMax),
  })
  .superRefine((value, ctx) => {
    const levels = value.tiers.map((tier) => tier.level);
    if (new Set(levels).size !== levels.length) {
      ctx.addIssue({ code: "custom", path: ["tiers"], message: "Each package level once" });
    }
    if (!levels.includes("BASIC")) {
      ctx.addIssue({ code: "custom", path: ["tiers"], message: "The Basic package is required" });
    }
    const ordered = SERVICE_LEVELS.flatMap((level) => value.tiers.filter((tier) => tier.level === level));
    for (let index = 1; index < ordered.length; index += 1) {
      const previous = ordered[index - 1];
      const current = ordered[index];
      if (previous && current && current.price <= previous.price) {
        ctx.addIssue({
          code: "custom",
          path: ["tiers", value.tiers.indexOf(current), "price"],
          message: "Higher packages must cost more",
        });
      }
    }
    const ids = value.intakeFields.map((field) => field.id);
    if (new Set(ids).size !== ids.length) {
      ctx.addIssue({ code: "custom", path: ["intakeFields"], message: "Questions must have unique ids" });
    }
  });

// ---------------------------------------------------------------------------
// Union and publishing rules
// ---------------------------------------------------------------------------

export const listingInputSchema = z.discriminatedUnion("type", [
  physicalListingSchema,
  digitalListingSchema,
  serviceListingSchema,
]);
export type ListingInput = z.infer<typeof listingInputSchema>;
export type PhysicalListingInput = z.infer<typeof physicalListingSchema>;
export type DigitalListingInput = z.infer<typeof digitalListingSchema>;
export type ServiceListingInput = z.infer<typeof serviceListingSchema>;

export interface PublishIssue {
  path: string;
  message: string;
}

/** What still blocks publishing a valid draft. Empty means ready. */
export function publishIssues(input: ListingInput, context: { warehouseCount: number; hasShippingProfile: boolean }): PublishIssue[] {
  const issues: PublishIssue[] = [];
  if (input.description.length < 30) {
    issues.push({ path: "description", message: "Write a description of at least 30 characters" });
  }
  switch (input.type) {
    case "PHYSICAL": {
      if (input.images.length === 0) issues.push({ path: "images", message: "Add at least one photo" });
      const active = input.skus.filter((sku) => sku.isActive);
      if (active.length === 0) issues.push({ path: "skus", message: "Add at least one variant that is for sale" });
      if (active.some((sku) => sku.price <= 0)) issues.push({ path: "skus", message: "Every variant for sale needs a price" });
      if (context.warehouseCount === 0) issues.push({ path: "skus", message: "Add a warehouse to ship from" });
      if (!context.hasShippingProfile) issues.push({ path: "skus", message: "Set your shipping rates in the Studio" });
      break;
    }
    case "DIGITAL": {
      if (!input.asset) issues.push({ path: "asset", message: "Upload the file buyers will download" });
      break;
    }
    case "SERVICE": {
      if (!input.tiers.some((tier) => tier.level === "BASIC")) issues.push({ path: "tiers", message: "Add the Basic package" });
      break;
    }
  }
  return issues;
}

/** Unit price after a wholesale discount, rounded to the nearest minor unit. */
export function discountedUnitPrice(price: number, discountBps: number): number {
  return Math.round((price * (10_000 - discountBps)) / 10_000);
}
