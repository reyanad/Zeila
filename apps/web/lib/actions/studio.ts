"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@marketplace/database";
import { fieldErrors, listingInputSchema, warehouseSchema, type ListingInput } from "@marketplace/shared-types";
import { recordAudit } from "@/lib/audit";
import { authorize } from "@/lib/auth/session";
import { publicAssetUrl } from "@/lib/env";
import { formError, formSuccess, type FormState } from "@/lib/form-state";
import { storeListingImage } from "@/lib/images";
import { describeRetry, rateLimit } from "@/lib/rate-limit";
import { getClientIp } from "@/lib/request";
import { scheduleSearchSync } from "@/lib/search-sync";
import {
  changeListingStatus,
  loadListingForEditor,
  saveListing,
  type ListingStatusAction,
  type StatusChangeResult,
  type StudioStore,
} from "@/lib/studio/listings";
import type { ListingStatus } from "@marketplace/database";

export type SaveListingActionResult =
  | {
      ok: true;
      id: string;
      slug: string;
      status: ListingStatus;
      /** The listing as stored, so the builder picks up new SKU ids. */
      input: ListingInput;
      imageUrls: Record<string, string>;
    }
  | { ok: false; message: string; fields?: Record<string, string> };

const STUDIO_PATH = "/seller/studio";

type StoreLookup = { ok: true; store: StudioStore; userId: string } | { ok: false; message: string };

async function sellerStore(): Promise<StoreLookup> {
  const auth = await authorize("listing:manage");
  if (!auth.ok) return { ok: false, message: auth.message };
  const store = await prisma.store.findUnique({
    where: { sellerId: auth.user.id },
    select: { id: true, status: true, currency: true },
  });
  if (!store) return { ok: false, message: "Open your store first." };
  if (store.status === "SUSPENDED" || store.status === "CLOSED") {
    return { ok: false, message: "Your store is not able to manage listings right now." };
  }
  return { ok: true, store, userId: auth.user.id };
}

/** Create (listingId null) or update a listing from the builder's typed payload. */
export async function saveListingAction(payload: unknown, listingId: string | null): Promise<SaveListingActionResult> {
  const lookup = await sellerStore();
  if (!lookup.ok) return { ok: false, message: lookup.message };

  const limit = await rateLimit(`listing-save:${lookup.userId}`, 120, 60 * 60);
  if (!limit.allowed) return { ok: false, message: `Too many saves. ${describeRetry(limit.retryAfterSeconds)}` };

  const parsed = listingInputSchema.safeParse(payload);
  if (!parsed.success) {
    return { ok: false, message: "Check the highlighted fields.", fields: fieldErrors(parsed.error) };
  }
  const result = await saveListing(lookup.store, parsed.data, listingId);
  if (!result.ok) return result;
  {
    if (!listingId) {
      await recordAudit({
        actorId: lookup.userId,
        action: "listing.create",
        entity: "Listing",
        entityId: result.id,
        data: { type: parsed.data.type },
        ipAddress: await getClientIp(),
      });
    }
    revalidatePath(STUDIO_PATH);
    revalidatePath(`${STUDIO_PATH}/listings/${result.id}`);
  }
  scheduleSearchSync({ kind: "listing", listingId: result.id });
  const stored = await loadListingForEditor(lookup.store.id, result.id);
  if (!stored) return { ok: false, message: "The listing was saved but could not be reloaded. Refresh the page." };
  const imageUrls = Object.fromEntries(stored.input.images.map((image) => [image.key, publicAssetUrl(image.key)]));
  return { ok: true, id: result.id, slug: result.slug, status: result.status, input: stored.input, imageUrls };
}

export async function listingStatusAction(listingId: string, action: ListingStatusAction): Promise<StatusChangeResult> {
  const lookup = await sellerStore();
  if (!lookup.ok) return { ok: false, message: lookup.message };
  const result = await changeListingStatus(lookup.store, listingId, action);
  if (result.ok) {
    scheduleSearchSync({ kind: "listing", listingId });
    await recordAudit({
      actorId: lookup.userId,
      action: `listing.${action}`,
      entity: "Listing",
      entityId: listingId,
      data: { status: result.status },
      ipAddress: await getClientIp(),
    });
    revalidatePath(STUDIO_PATH);
    revalidatePath(`${STUDIO_PATH}/listings/${listingId}`);
  }
  return result;
}

export type ImageUploadActionResult = { ok: true; key: string; url: string } | { ok: false; message: string };

export async function uploadListingImageAction(formData: FormData): Promise<ImageUploadActionResult> {
  const lookup = await sellerStore();
  if (!lookup.ok) return { ok: false, message: lookup.message };
  const limit = await rateLimit(`listing-image:${lookup.userId}`, 120, 60 * 60);
  if (!limit.allowed) return { ok: false, message: `Too many uploads. ${describeRetry(limit.retryAfterSeconds)}` };

  const file = formData.get("image");
  if (!(file instanceof File) || file.size === 0) return { ok: false, message: "Choose an image to upload." };
  const stored = await storeListingImage(lookup.store.id, file);
  if (!stored.ok) return stored;
  return { ok: true, key: stored.key, url: publicAssetUrl(stored.key) };
}

export async function createWarehouseAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const lookup = await sellerStore();
  if (!lookup.ok) return formError(lookup.message);

  const read = (name: string) => {
    const value = formData.get(name);
    return typeof value === "string" ? value : "";
  };
  const parsed = warehouseSchema.safeParse({
    name: read("name"),
    line1: read("line1"),
    line2: read("line2"),
    city: read("city"),
    state: read("state"),
    postalCode: read("postalCode"),
    country: read("country"),
  });
  if (!parsed.success) {
    const values = Object.fromEntries(["name", "line1", "line2", "city", "state", "postalCode", "country"].map((key) => [key, read(key)]));
    return formError("Check the highlighted fields.", fieldErrors(parsed.error), values);
  }
  const input = parsed.data;
  const count = await prisma.warehouse.count({ where: { storeId: lookup.store.id } });
  if (count >= 20) return formError("A store can have at most 20 warehouses.");

  await prisma.warehouse.create({
    data: {
      storeId: lookup.store.id,
      name: input.name,
      line1: input.line1,
      line2: input.line2 || null,
      city: input.city,
      state: input.state || null,
      postalCode: input.postalCode || null,
      country: input.country,
      isDefault: count === 0,
    },
  });
  revalidatePath(`${STUDIO_PATH}/warehouses`);
  return formSuccess(`${input.name} added.`);
}
