import "server-only";

/**
 * Upload checks for user-supplied files. The declared MIME type and file name
 * are never trusted: the type is detected from the file's leading bytes.
 */

export const SNIFFABLE_TYPES = ["image/jpeg", "image/png", "image/webp", "application/pdf"] as const;
export type SniffableType = (typeof SNIFFABLE_TYPES)[number];

export const EXTENSION_BY_TYPE: Readonly<Record<SniffableType, string>> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "application/pdf": "pdf",
};

function startsWith(bytes: Uint8Array, signature: readonly number[], offset = 0): boolean {
  return signature.every((byte, index) => bytes[offset + index] === byte);
}

export function sniffContentType(bytes: Uint8Array): SniffableType | null {
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8)) return "image/webp";
  if (startsWith(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d])) return "application/pdf";
  return null;
}

/** Display-safe file name: no path, no control characters, at most 120 characters. */
export function safeFileName(name: string, fallback: string): string {
  const base = name.split(/[\\/]/).pop() ?? "";
  const cleaned = base.replace(/[^\p{L}\p{N} ._()-]/gu, "_").trim().slice(0, 120);
  return cleaned.length > 0 ? cleaned : fallback;
}

export type UploadCheck<T extends SniffableType> =
  | { ok: true; bytes: Uint8Array; contentType: T; fileName: string }
  | { ok: false; message: string };

export async function readUpload<T extends SniffableType>(
  file: File,
  maxBytes: number,
  allowed: readonly T[],
): Promise<UploadCheck<T>> {
  if (file.size === 0) return { ok: false, message: "The file is empty" };
  if (file.size > maxBytes) {
    return { ok: false, message: `Files must be ${Math.floor(maxBytes / (1024 * 1024))} MB or smaller` };
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  const detected = sniffContentType(bytes);
  const match = allowed.find((type) => type === detected);
  if (!match) {
    const names = allowed.map((type) => EXTENSION_BY_TYPE[type].toUpperCase()).join(", ");
    return { ok: false, message: `Upload a ${names} file` };
  }
  return { ok: true, bytes, contentType: match, fileName: safeFileName(file.name, `upload.${EXTENSION_BY_TYPE[match]}`) };
}
