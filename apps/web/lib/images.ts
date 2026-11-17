import "server-only";
import { randomBytes } from "node:crypto";
import sharp from "sharp";
import { getStorage } from "@/lib/storage";
import { readUpload } from "@/lib/uploads";

export const LISTING_IMAGE_MAX_BYTES = 10 * 1024 * 1024;
const MAX_EDGE = 2000;

export type ImageUploadResult = { ok: true; key: string } | { ok: false; message: string };

/**
 * Store a listing photo in the public bucket. Every image is re-encoded to
 * WebP: this applies the EXIF orientation, caps the size, and strips all
 * metadata, including GPS coordinates that phones embed in photos.
 */
export async function storeListingImage(storeId: string, file: File): Promise<ImageUploadResult> {
  const checked = await readUpload(file, LISTING_IMAGE_MAX_BYTES, ["image/jpeg", "image/png", "image/webp"] as const);
  if (!checked.ok) return checked;

  let output: Buffer;
  try {
    output = await sharp(checked.bytes, { limitInputPixels: 50_000_000 })
      .rotate()
      .resize({ width: MAX_EDGE, height: MAX_EDGE, fit: "inside", withoutEnlargement: true })
      .webp({ quality: 82 })
      .toBuffer();
  } catch {
    return { ok: false, message: "That image could not be read. Try a different file." };
  }

  const key = `listing-images/${storeId.toLowerCase()}/${randomBytes(16).toString("hex")}.webp`;
  await getStorage().put("public", key, output, "image/webp");
  return { ok: true, key };
}

/** Keys a store may reference: only images it uploaded itself. */
export function isOwnListingImage(storeId: string, key: string): boolean {
  return key.startsWith(`listing-images/${storeId.toLowerCase()}/`);
}
