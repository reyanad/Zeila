import "server-only";
import { randomBytes } from "node:crypto";
import { prisma, type ListingStatus, type ListingType, type Prisma } from "@marketplace/database";
import {
  discountedUnitPrice,
  publishIssues,
  type DigitalAssetRef,
  type DigitalListingInput,
  type IntakeField,
  type ListingInput,
  type PhysicalListingInput,
  type PublishIssue,
  type ServiceListingInput,
  type VariantAxis,
  type WholesaleTierDraft,
} from "@marketplace/shared-types";
import { parseShippingProfile } from "@marketplace/core";
import { verifyTicket } from "@/lib/crypto/tokens";
import { isUniqueViolation } from "@/lib/db-errors";
import { isOwnListingImage } from "@/lib/images";
import { getSetting } from "@/lib/settings";

/**
 * Persistence for the Vendor Studio. One entry point saves any listing type;
 * type-specific rows (SKUs + inventory + wholesale tiers, digital asset,
 * service tiers + intake form) are written in the same transaction as the
 * listing itself.
 *
 * Editor-only settings live in `Listing.attributes`:
 *   { variantAxes, wholesaleTiers }              physical
 *   { digital: { price, version, ... } }         digital (kept even before a file exists)
 */

export interface StudioStore {
  id: string;
  status: string;
  currency: string;
}

export type SaveListingResult =
  | { ok: true; id: string; slug: string; status: ListingStatus }
  | { ok: false; message: string; fields?: Record<string, string> };

/** Payload signed by the upload route for a file streamed into the vault. */
export interface UploadTicket {
  storeId: string;
  vaultKey: string;
  fileName: string;
  sizeBytes: number;
  checksumSha256: string;
}

interface DigitalSettings {
  price: number;
  version: string;
  changelog: string;
  licenseKeys: boolean;
  licensePrefix: string | null;
  activationsLimit: number;
  downloadLimit: number | null;
}

/** Marker in the code of a SKU retired because past orders still reference it. */
const RETIRED_MARKER = "~";

function slugify(title: string): string {
  const base = title
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return base.length > 0 ? base : "listing";
}

function licenseTemplate(input: DigitalListingInput): string | null {
  if (!input.licenseKeys) return null;
  return `${input.licensePrefix ?? "KEY"}-{{BLOCK4}}-{{BLOCK4}}-{{BLOCK4}}-{{BLOCK4}}`;
}

function priceRange(prices: number[]): { minPrice: number; maxPrice: number } {
  if (prices.length === 0) return { minPrice: 0, maxPrice: 0 };
  return { minPrice: Math.min(...prices), maxPrice: Math.max(...prices) };
}

class ListingSaveError extends Error {
  constructor(
    message: string,
    readonly fields?: Record<string, string>,
  ) {
    super(message);
  }
}

// ---------------------------------------------------------------------------
// Validation that needs the database
// ---------------------------------------------------------------------------

async function checkReferences(store: StudioStore, input: ListingInput): Promise<void> {
  const fields: Record<string, string> = {};

  if (input.categoryId) {
    const category = await prisma.category.findFirst({ where: { id: input.categoryId, isActive: true }, select: { id: true } });
    if (!category) fields.categoryId = "Choose a category from the list";
  }
  input.images.forEach((image, index) => {
    if (!isOwnListingImage(store.id, image.key)) fields[`images.${index}`] = "Upload this image again";
  });

  if (input.type === "PHYSICAL") {
    const warehouses = await prisma.warehouse.findMany({ where: { storeId: store.id }, select: { id: true } });
    const owned = new Set(warehouses.map((warehouse) => warehouse.id));
    input.skus.forEach((sku, index) => {
      if (sku.stock.some((level) => !owned.has(level.warehouseId))) fields[`skus.${index}.stock`] = "Unknown warehouse";
    });
  }

  if (Object.keys(fields).length > 0) throw new ListingSaveError("Check the highlighted fields.", fields);
}

/** A new file must carry a valid upload ticket for this store; an unchanged file must match the stored one. */
async function verifyAsset(store: StudioStore, asset: DigitalAssetRef, listingId: string | null): Promise<void> {
  if (asset.token) {
    const ticket = verifyTicket<UploadTicket>("upload-ticket", asset.token);
    const matches =
      ticket !== null &&
      ticket.storeId === store.id &&
      ticket.vaultKey === asset.vaultKey &&
      ticket.sizeBytes === asset.sizeBytes &&
      ticket.checksumSha256 === asset.checksumSha256;
    if (!matches) throw new ListingSaveError("The uploaded file could not be verified. Upload it again.", { asset: "Upload the file again" });
    return;
  }
  const current = listingId
    ? await prisma.digitalAsset.findUnique({ where: { listingId }, select: { vaultKey: true } })
    : null;
  if (!current || current.vaultKey !== asset.vaultKey) {
    throw new ListingSaveError("The uploaded file could not be verified. Upload it again.", { asset: "Upload the file again" });
  }
}

// ---------------------------------------------------------------------------
// Type-specific writers (run inside the listing transaction)
// ---------------------------------------------------------------------------

async function writePhysical(tx: Prisma.TransactionClient, listingId: string, input: PhysicalListingInput): Promise<void> {
  const existing = await tx.sku.findMany({
    where: { listingId },
    select: { id: true, skuCode: true, _count: { select: { orderItems: true } } },
  });
  const existingById = new Map(existing.map((sku) => [sku.id, sku]));
  const keep = new Set(input.skus.map((sku) => sku.id).filter((id): id is string => id !== null && existingById.has(id)));

  // Remove SKUs the seller deleted; keep (but retire) any that past orders reference.
  for (const sku of existing) {
    if (keep.has(sku.id)) continue;
    if (sku._count.orderItems > 0) {
      await tx.sku.update({
        where: { id: sku.id },
        data: { isActive: false, skuCode: `${sku.skuCode}${RETIRED_MARKER}${sku.id.slice(-6)}` },
      });
    } else {
      await tx.sku.delete({ where: { id: sku.id } });
    }
  }

  const skuIds: string[] = [];
  for (const sku of input.skus) {
    const data = {
      skuCode: sku.skuCode,
      variantValues: sku.variantValues,
      price: sku.price,
      compareAtPrice: sku.compareAtPrice,
      barcode: sku.barcode,
      weightGrams: sku.weightGrams,
      isActive: sku.isActive,
    };
    const saved =
      sku.id && keep.has(sku.id)
        ? await tx.sku.update({ where: { id: sku.id }, data, select: { id: true } })
        : await tx.sku.create({ data: { ...data, listingId }, select: { id: true } });
    skuIds.push(saved.id);

    for (const level of sku.stock) {
      await tx.inventoryLevel.upsert({
        where: { warehouseId_skuId: { warehouseId: level.warehouseId, skuId: saved.id } },
        create: { warehouseId: level.warehouseId, skuId: saved.id, onHand: level.onHand },
        update: { onHand: level.onHand },
      });
    }
  }

  // Wholesale prices are derived per SKU from the listing-level discount tiers.
  await tx.wholesaleTier.deleteMany({ where: { sku: { listingId } } });
  const tiers = input.skus.flatMap((sku, index) =>
    input.wholesaleTiers.map((tier) => ({
      skuId: skuIds[index] as string,
      minQty: tier.minQty,
      unitPrice: discountedUnitPrice(sku.price, tier.discountBps),
    })),
  );
  if (tiers.length > 0) await tx.wholesaleTier.createMany({ data: tiers });
}

async function writeDigital(tx: Prisma.TransactionClient, listingId: string, input: DigitalListingInput): Promise<void> {
  if (!input.asset) return;
  const data = {
    price: input.price,
    vaultKey: input.asset.vaultKey,
    fileName: input.asset.fileName,
    sizeBytes: BigInt(input.asset.sizeBytes),
    checksumSha256: input.asset.checksumSha256,
    version: input.version,
    changelog: input.changelog.length > 0 ? input.changelog : null,
    licenseTemplate: licenseTemplate(input),
    activationsLimit: input.activationsLimit,
    downloadLimit: input.downloadLimit,
  };
  await tx.digitalAsset.upsert({ where: { listingId }, create: { ...data, listingId }, update: data });
}

async function writeService(tx: Prisma.TransactionClient, listingId: string, input: ServiceListingInput): Promise<void> {
  const existing = await tx.serviceTier.findMany({
    where: { listingId },
    select: { id: true, level: true, _count: { select: { orderItems: true } } },
  });
  const wanted = new Set(input.tiers.map((tier) => tier.level));
  for (const tier of existing) {
    if (wanted.has(tier.level)) continue;
    if (tier._count.orderItems > 0) await tx.serviceTier.update({ where: { id: tier.id }, data: { isActive: false } });
    else await tx.serviceTier.delete({ where: { id: tier.id } });
  }
  for (const tier of input.tiers) {
    const data = {
      title: tier.title,
      description: tier.description,
      price: tier.price,
      deliveryDays: tier.deliveryDays,
      revisions: tier.revisions,
      features: tier.features,
      isActive: true,
    };
    await tx.serviceTier.upsert({
      where: { listingId_level: { listingId, level: tier.level } },
      create: { ...data, listingId, level: tier.level },
      update: data,
    });
  }
  // The form is kept (possibly empty) so buyers' past answers stay attached to it.
  const fields = input.intakeFields as Prisma.InputJsonValue;
  await tx.intakeForm.upsert({ where: { listingId }, create: { listingId, fields }, update: { fields } });
}

function attributesFor(input: ListingInput): Prisma.InputJsonObject {
  switch (input.type) {
    case "PHYSICAL":
      return { variantAxes: input.variantAxes, wholesaleTiers: input.wholesaleTiers };
    case "DIGITAL": {
      const digital: DigitalSettings = {
        price: input.price,
        version: input.version,
        changelog: input.changelog,
        licenseKeys: input.licenseKeys,
        licensePrefix: input.licensePrefix,
        activationsLimit: input.activationsLimit,
        downloadLimit: input.downloadLimit,
      };
      return { digital: { ...digital } };
    }
    case "SERVICE":
      return {};
  }
}

function pricesFor(input: ListingInput): { minPrice: number; maxPrice: number } {
  switch (input.type) {
    case "PHYSICAL":
      return priceRange(input.skus.filter((sku) => sku.isActive).map((sku) => sku.price));
    case "DIGITAL":
      return priceRange([input.price]);
    case "SERVICE":
      return priceRange(input.tiers.map((tier) => tier.price));
  }
}

// ---------------------------------------------------------------------------
// Save
// ---------------------------------------------------------------------------

export async function saveListing(store: StudioStore, input: ListingInput, listingId: string | null): Promise<SaveListingResult> {
  try {
    if (listingId) {
      const current = await prisma.listing.findFirst({ where: { id: listingId, storeId: store.id }, select: { type: true, status: true } });
      if (!current) return { ok: false, message: "That listing does not exist." };
      if (current.type !== input.type) return { ok: false, message: "A listing's type cannot be changed." };
      if (current.status === "ARCHIVED") return { ok: false, message: "Archived listings cannot be edited." };
    }
    await checkReferences(store, input);
    if (input.type === "DIGITAL" && input.asset) await verifyAsset(store, input.asset, listingId);

    const images = [...input.images]
      .sort((a, b) => a.position - b.position)
      .map((image, position) => ({ key: image.key, alt: image.alt, position }));
    const common = {
      title: input.title,
      summary: input.summary.length > 0 ? input.summary : null,
      description: input.description,
      categoryId: input.categoryId,
      tags: input.tags,
      images,
      currency: store.currency,
      attributes: attributesFor(input),
      ...pricesFor(input),
    };

    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const saved = await prisma.$transaction(
          async (tx) => {
            const listing = listingId
              ? await tx.listing.update({ where: { id: listingId }, data: common, select: { id: true, slug: true, status: true } })
              : await tx.listing.create({
                  data: {
                    ...common,
                    storeId: store.id,
                    type: input.type as ListingType,
                    status: "DRAFT",
                    slug: `${slugify(input.title)}-${randomBytes(3).toString("hex")}`,
                  },
                  select: { id: true, slug: true, status: true },
                });
            if (input.type === "PHYSICAL") await writePhysical(tx, listing.id, input);
            if (input.type === "DIGITAL") await writeDigital(tx, listing.id, input);
            if (input.type === "SERVICE") await writeService(tx, listing.id, input);
            return listing;
          },
          { timeout: 30_000 },
        );
        return { ok: true, id: saved.id, slug: saved.slug, status: saved.status };
      } catch (error) {
        // A slug collision on create is retried with a new random suffix.
        if (!listingId && isUniqueViolation(error) && attempt < 2) continue;
        if (isUniqueViolation(error)) {
          return { ok: false, message: "Two variants share a SKU code. Give each variant a unique code.", fields: { skus: "SKU codes must be unique" } };
        }
        throw error;
      }
    }
    return { ok: false, message: "The listing could not be saved. Try again." };
  } catch (error) {
    if (error instanceof ListingSaveError) return { ok: false, message: error.message, fields: error.fields };
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Load for the editor
// ---------------------------------------------------------------------------

export interface EditableListing {
  id: string;
  slug: string;
  status: ListingStatus;
  moderationNote: string | null;
  input: ListingInput;
}

function asAxes(value: unknown): VariantAxis[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((axis) => {
    if (typeof axis !== "object" || axis === null) return [];
    const { name, values } = axis as { name?: unknown; values?: unknown };
    if (typeof name !== "string" || !Array.isArray(values)) return [];
    return [{ name, values: values.filter((v): v is string => typeof v === "string") }];
  });
}

function asTiers(value: unknown): WholesaleTierDraft[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((tier) => {
    if (typeof tier !== "object" || tier === null) return [];
    const { minQty, discountBps } = tier as { minQty?: unknown; discountBps?: unknown };
    return typeof minQty === "number" && typeof discountBps === "number" ? [{ minQty, discountBps }] : [];
  });
}

function asRecord(value: Prisma.JsonValue | null): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function asImages(value: Prisma.JsonValue): ListingInput["images"] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((image, index) => {
    const record = asRecord(image);
    return typeof record.key === "string"
      ? [{ key: record.key, alt: typeof record.alt === "string" ? record.alt : "", position: index }]
      : [];
  });
}

function asStringRecord(value: Prisma.JsonValue): Record<string, string> {
  const record = asRecord(value);
  return Object.fromEntries(Object.entries(record).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
}

export async function loadListingForEditor(storeId: string, listingId: string): Promise<EditableListing | null> {
  const listing = await prisma.listing.findFirst({
    where: { id: listingId, storeId },
    include: {
      skus: { orderBy: { createdAt: "asc" }, include: { inventory: true } },
      digitalAsset: true,
      serviceTiers: { where: { isActive: true } },
      intakeForm: true,
    },
  });
  if (!listing) return null;

  const attributes = asRecord(listing.attributes);
  const common = {
    title: listing.title,
    summary: listing.summary ?? "",
    description: listing.description,
    categoryId: listing.categoryId,
    tags: listing.tags,
    images: asImages(listing.images),
  };

  let input: ListingInput;
  switch (listing.type) {
    case "PHYSICAL":
      input = {
        type: "PHYSICAL",
        ...common,
        variantAxes: asAxes(attributes.variantAxes),
        wholesaleTiers: asTiers(attributes.wholesaleTiers),
        skus: listing.skus
          .filter((sku) => !sku.skuCode.includes(RETIRED_MARKER))
          .map((sku) => ({
            id: sku.id,
            skuCode: sku.skuCode,
            variantValues: asStringRecord(sku.variantValues),
            price: sku.price,
            compareAtPrice: sku.compareAtPrice,
            barcode: sku.barcode,
            weightGrams: sku.weightGrams,
            isActive: sku.isActive,
            stock: sku.inventory.map((level) => ({ warehouseId: level.warehouseId, onHand: level.onHand })),
          })),
      };
      break;
    case "DIGITAL": {
      const settings = asRecord((attributes.digital ?? null) as Prisma.JsonValue);
      const asset = listing.digitalAsset;
      input = {
        type: "DIGITAL",
        ...common,
        price: typeof settings.price === "number" ? settings.price : (asset?.price ?? 0),
        version: typeof settings.version === "string" ? settings.version : (asset?.version ?? "1.0"),
        changelog: typeof settings.changelog === "string" ? settings.changelog : (asset?.changelog ?? ""),
        licenseKeys: typeof settings.licenseKeys === "boolean" ? settings.licenseKeys : Boolean(asset?.licenseTemplate),
        licensePrefix: typeof settings.licensePrefix === "string" ? settings.licensePrefix : null,
        activationsLimit: typeof settings.activationsLimit === "number" ? settings.activationsLimit : (asset?.activationsLimit ?? 3),
        downloadLimit: typeof settings.downloadLimit === "number" ? settings.downloadLimit : (asset?.downloadLimit ?? null),
        asset: asset
          ? {
              vaultKey: asset.vaultKey,
              fileName: asset.fileName,
              sizeBytes: Number(asset.sizeBytes),
              checksumSha256: asset.checksumSha256,
              token: null,
            }
          : null,
      };
      break;
    }
    case "SERVICE": {
      const order = { BASIC: 0, STANDARD: 1, PREMIUM: 2 } as const;
      input = {
        type: "SERVICE",
        ...common,
        tiers: [...listing.serviceTiers]
          .sort((a, b) => order[a.level] - order[b.level])
          .map((tier) => ({
            level: tier.level,
            title: tier.title,
            description: tier.description,
            price: tier.price,
            deliveryDays: tier.deliveryDays,
            revisions: tier.revisions,
            features: Array.isArray(tier.features) ? tier.features.filter((f): f is string => typeof f === "string") : [],
          })),
        intakeFields: Array.isArray(listing.intakeForm?.fields) ? (listing.intakeForm.fields as unknown as IntakeField[]) : [],
      };
      break;
    }
  }

  return { id: listing.id, slug: listing.slug, status: listing.status, moderationNote: listing.moderationNote, input };
}

// ---------------------------------------------------------------------------
// Status changes
// ---------------------------------------------------------------------------

export type ListingStatusAction = "publish" | "pause" | "archive" | "delete";

export type StatusChangeResult =
  | { ok: true; status: ListingStatus | "DELETED" }
  | { ok: false; message: string; issues?: PublishIssue[] };

export async function changeListingStatus(
  store: StudioStore,
  listingId: string,
  action: ListingStatusAction,
): Promise<StatusChangeResult> {
  const listing = await prisma.listing.findFirst({
    where: { id: listingId, storeId: store.id },
    select: { id: true, status: true, publishedAt: true, _count: { select: { orderItems: true } } },
  });
  if (!listing) return { ok: false, message: "That listing does not exist." };

  switch (action) {
    case "publish": {
      if (listing.status === "ARCHIVED") return { ok: false, message: "Archived listings cannot be published." };
      if (listing.status === "ACTIVE" || listing.status === "PENDING_REVIEW") return { ok: true, status: listing.status };
      if (store.status !== "ACTIVE") {
        return { ok: false, message: "Your store must be active first: finish identity verification and payouts in Seller setup." };
      }
      const editable = await loadListingForEditor(store.id, listingId);
      if (!editable) return { ok: false, message: "That listing does not exist." };
      const [warehouseCount, storeRow] = await Promise.all([
        prisma.warehouse.count({ where: { storeId: store.id } }),
        prisma.store.findUnique({ where: { id: store.id }, select: { shippingProfile: true } }),
      ]);
      const hasShippingProfile = parseShippingProfile(storeRow?.shippingProfile ?? null) !== null;
      const issues = publishIssues(editable.input, { warehouseCount, hasShippingProfile });
      if (issues.length > 0) return { ok: false, message: "Finish these before publishing.", issues };

      const reviewFirst = (await getSetting("listingReviewMode")) === "pre";
      const status: ListingStatus = reviewFirst ? "PENDING_REVIEW" : "ACTIVE";
      await prisma.listing.update({
        where: { id: listing.id },
        data: { status, publishedAt: listing.publishedAt ?? (reviewFirst ? null : new Date()), moderationNote: null },
      });
      return { ok: true, status };
    }
    case "pause": {
      if (listing.status !== "ACTIVE") return { ok: false, message: "Only live listings can be paused." };
      await prisma.listing.update({ where: { id: listing.id }, data: { status: "PAUSED" } });
      return { ok: true, status: "PAUSED" };
    }
    case "archive": {
      await prisma.listing.update({ where: { id: listing.id }, data: { status: "ARCHIVED" } });
      return { ok: true, status: "ARCHIVED" };
    }
    case "delete": {
      if (listing.status !== "DRAFT" || listing._count.orderItems > 0) {
        return { ok: false, message: "Only drafts that were never sold can be deleted. Archive it instead." };
      }
      await prisma.listing.delete({ where: { id: listing.id } });
      return { ok: true, status: "DELETED" };
    }
  }
}
