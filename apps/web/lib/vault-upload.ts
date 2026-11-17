import "server-only";
import { randomBytes } from "node:crypto";
import { PassThrough, Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as WebReadableStream } from "node:stream/web";
import { createEncryptStream, MeasureStream, UploadTooLargeError } from "@/lib/crypto/stream";
import { getStorage } from "@/lib/storage";
import { safeFileName } from "@/lib/uploads";

export interface VaultUpload {
  vaultKey: string;
  fileName: string;
  sizeBytes: number;
  checksumSha256: string;
}

export type VaultUploadResult = { ok: true; upload: VaultUpload } | { ok: false; status: number; message: string };

/**
 * Stream a request body into the vault: size-limited, hashed and encrypted
 * on the way, never buffered. The original file name travels in
 * `X-File-Name` (URI-encoded).
 */
export async function streamIntoVault(request: Request, keyPrefix: string, maxBytes: number): Promise<VaultUploadResult> {
  const megabytes = Math.floor(maxBytes / (1024 * 1024));
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > maxBytes) return { ok: false, status: 413, message: `Files can be at most ${megabytes} MB.` };
  if (!request.body) return { ok: false, status: 400, message: "Choose a file to upload." };

  let rawName = "";
  try {
    rawName = decodeURIComponent(request.headers.get("x-file-name") ?? "");
  } catch {
    rawName = "";
  }
  const fileName = safeFileName(rawName, "file.bin");
  const vaultKey = `${keyPrefix}/${randomBytes(16).toString("hex")}.bin`;

  const measure = new MeasureStream(maxBytes);
  const sink = new PassThrough();
  const storage = getStorage();
  const piping = pipeline(Readable.fromWeb(request.body as WebReadableStream<Uint8Array>), measure, createEncryptStream(vaultKey), sink);
  const storing = storage.putStream("vault", vaultKey, sink, "application/octet-stream").catch((error: unknown) => {
    sink.destroy(error instanceof Error ? error : new Error(String(error)));
    throw error;
  });
  try {
    await Promise.all([piping, storing]);
  } catch (error) {
    await storage.remove("vault", vaultKey).catch(() => undefined);
    if (error instanceof UploadTooLargeError) return { ok: false, status: 413, message: `Files can be at most ${megabytes} MB.` };
    console.error("[upload] vault upload failed", error);
    return { ok: false, status: 500, message: "The upload did not finish. Try again." };
  }
  if (measure.bytes === 0) {
    await storage.remove("vault", vaultKey).catch(() => undefined);
    return { ok: false, status: 400, message: "The file is empty." };
  }
  return { ok: true, upload: { vaultKey, fileName, sizeBytes: measure.bytes, checksumSha256: measure.digestHex() } };
}
