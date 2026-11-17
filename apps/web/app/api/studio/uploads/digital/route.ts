import { randomBytes } from "node:crypto";
import { PassThrough, Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as WebReadableStream } from "node:stream/web";
import { prisma } from "@marketplace/database";
import { authorize } from "@/lib/auth/session";
import { createEncryptStream, MeasureStream, UploadTooLargeError } from "@/lib/crypto/stream";
import { signTicket } from "@/lib/crypto/tokens";
import { digitalUploadMaxBytes } from "@/lib/env";
import { describeRetry, rateLimit } from "@/lib/rate-limit";
import { isSameOrigin } from "@/lib/request";
import { getStorage } from "@/lib/storage";
import type { UploadTicket } from "@/lib/studio/listings";
import { safeFileName } from "@/lib/uploads";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 900;

const TICKET_TTL_SECONDS = 24 * 60 * 60;

/**
 * Stream a digital product into the vault. The body is the raw file; the
 * original name travels in `X-File-Name` (URI-encoded). Nothing is buffered
 * in memory: bytes are measured, hashed (SHA-256 of the plaintext) and
 * encrypted on the way to storage. The response carries a signed ticket the
 * listing builder sends back when it saves the listing.
 */
export async function POST(request: Request): Promise<Response> {
  if (!isSameOrigin(request)) return Response.json({ error: "Cross-site request refused" }, { status: 403 });

  const auth = await authorize("listing:manage");
  if (!auth.ok) return Response.json({ error: auth.message }, { status: auth.code === "UNAUTHORIZED" ? 401 : 403 });

  const store = await prisma.store.findUnique({ where: { sellerId: auth.user.id }, select: { id: true, status: true } });
  if (!store || store.status === "SUSPENDED" || store.status === "CLOSED") {
    return Response.json({ error: "Open your store first." }, { status: 403 });
  }

  const limit = await rateLimit(`digital-upload:${auth.user.id}`, 30, 60 * 60);
  if (!limit.allowed) return Response.json({ error: `Too many uploads. ${describeRetry(limit.retryAfterSeconds)}` }, { status: 429 });

  const maxBytes = digitalUploadMaxBytes();
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > maxBytes) {
    return Response.json({ error: `Files can be at most ${Math.floor(maxBytes / (1024 * 1024))} MB.` }, { status: 413 });
  }
  if (!request.body) return Response.json({ error: "Choose a file to upload." }, { status: 400 });

  let rawName = "";
  try {
    rawName = decodeURIComponent(request.headers.get("x-file-name") ?? "");
  } catch {
    rawName = "";
  }
  const fileName = safeFileName(rawName, "download.bin");
  const vaultKey = `digital/${store.id}/${randomBytes(16).toString("hex")}.bin`;

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
    if (error instanceof UploadTooLargeError) {
      return Response.json({ error: `Files can be at most ${Math.floor(maxBytes / (1024 * 1024))} MB.` }, { status: 413 });
    }
    console.error("[upload] digital file upload failed", error);
    return Response.json({ error: "The upload did not finish. Try again." }, { status: 500 });
  }

  if (measure.bytes === 0) {
    await storage.remove("vault", vaultKey).catch(() => undefined);
    return Response.json({ error: "The file is empty." }, { status: 400 });
  }

  const ticket: UploadTicket = {
    storeId: store.id,
    vaultKey,
    fileName,
    sizeBytes: measure.bytes,
    checksumSha256: measure.digestHex(),
  };
  return Response.json({
    vaultKey,
    fileName,
    sizeBytes: ticket.sizeBytes,
    checksumSha256: ticket.checksumSha256,
    token: signTicket("upload-ticket", ticket, TICKET_TTL_SECONDS),
  });
}
