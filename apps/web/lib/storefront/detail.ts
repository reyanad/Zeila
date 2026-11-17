import "server-only";
import { countryOptions } from "@marketplace/shared-types";
import type { PurchaseData } from "@/components/storefront/purchase-panel";
import { publicAssetUrl } from "@/lib/env";
import type { ListingDetail } from "./listings";

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value < 10 ? 1 : 0)} ${units[unit]}`;
}

export function listingImages(listing: Pick<ListingDetail, "images" | "title">): Array<{ url: string; alt: string }> {
  if (!Array.isArray(listing.images)) return [];
  return listing.images.flatMap((image) => {
    if (typeof image !== "object" || image === null || Array.isArray(image)) return [];
    const { key, alt } = image as { key?: unknown; alt?: unknown };
    return typeof key === "string" ? [{ url: publicAssetUrl(key), alt: typeof alt === "string" ? alt : "" }] : [];
  });
}

function countryName(code: string): string {
  return countryOptions().find((country) => country.code === code)?.name ?? code;
}

function axesOf(listing: ListingDetail): Array<{ name: string; values: string[] }> {
  const attributes = listing.attributes;
  const stored =
    typeof attributes === "object" && attributes !== null && !Array.isArray(attributes) ? (attributes as Record<string, unknown>).variantAxes : null;
  const fromAttributes = Array.isArray(stored)
    ? stored.flatMap((axis) => {
        if (typeof axis !== "object" || axis === null) return [];
        const { name, values } = axis as { name?: unknown; values?: unknown };
        return typeof name === "string" && Array.isArray(values) ? [{ name, values: values.filter((v): v is string => typeof v === "string") }] : [];
      })
    : [];
  // Only offer values that still exist on an active SKU.
  return fromAttributes
    .map((axis) => ({
      name: axis.name,
      values: axis.values.filter((value) =>
        listing.skus.some((sku) => (sku.variantValues as Record<string, unknown> | null)?.[axis.name] === value),
      ),
    }))
    .filter((axis) => axis.values.length > 0);
}

export function purchaseData(listing: ListingDetail): PurchaseData | null {
  switch (listing.type) {
    case "PHYSICAL": {
      const warehouse = listing.store.warehouses[0];
      return {
        type: "PHYSICAL",
        currency: listing.currency,
        axes: axesOf(listing),
        shipsFrom: warehouse ? `${warehouse.city}, ${countryName(warehouse.country)}` : null,
        skus: listing.skus.map((sku) => ({
          id: sku.id,
          variantValues: Object.fromEntries(
            Object.entries((sku.variantValues ?? {}) as Record<string, unknown>).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
          ),
          price: sku.price,
          compareAtPrice: sku.compareAtPrice,
          available: Math.max(0, sku.inventory.reduce((sum, level) => sum + level.onHand - level.reserved, 0)),
          wholesale: sku.wholesaleTiers,
        })),
      };
    }
    case "DIGITAL": {
      const asset = listing.digitalAsset;
      if (!asset) return null;
      return {
        type: "DIGITAL",
        currency: listing.currency,
        price: asset.price,
        fileName: asset.fileName,
        sizeLabel: formatBytes(Number(asset.sizeBytes)),
        version: asset.version,
        licensed: asset.licenseTemplate !== null,
        activationsLimit: asset.activationsLimit,
        downloadLimit: asset.downloadLimit,
      };
    }
    case "SERVICE": {
      const order = { BASIC: 0, STANDARD: 1, PREMIUM: 2 } as const;
      return {
        type: "SERVICE",
        currency: listing.currency,
        tiers: [...listing.serviceTiers]
          .sort((a, b) => order[a.level] - order[b.level])
          .map((tier) => ({
            id: tier.id,
            level: tier.level,
            title: tier.title,
            description: tier.description,
            price: tier.price,
            deliveryDays: tier.deliveryDays,
            revisions: tier.revisions,
            features: Array.isArray(tier.features) ? tier.features.filter((f): f is string => typeof f === "string") : [],
          })),
      };
    }
  }
}

export { countryName };
