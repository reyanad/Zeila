import "server-only";
import { Readable } from "node:stream";
import { createDecryptStream, parseStreamHeader, STREAM_HEADER_BYTES, STREAM_TAG_BYTES } from "@/lib/crypto/stream";
import { getStorage } from "@/lib/storage";

async function readAll(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk as Uint8Array));
  return Buffer.concat(chunks);
}

/**
 * Stream a vault object back decrypted as a download. The header and tag are
 * read with two small ranged reads; the body is decrypted as it streams.
 */
export async function vaultDownloadResponse(key: string, fileName: string): Promise<Response> {
  const storage = getStorage();
  const size = await storage.size("vault", key);
  if (size === null || size < STREAM_HEADER_BYTES + STREAM_TAG_BYTES) return new Response("Not found", { status: 404 });
  const header = await readAll(await storage.getStream("vault", key, { start: 0, end: STREAM_HEADER_BYTES - 1 }));
  const tag = await readAll(await storage.getStream("vault", key, { start: size - STREAM_TAG_BYTES, end: size - 1 }));
  const plaintextSize = size - STREAM_HEADER_BYTES - STREAM_TAG_BYTES;
  const body =
    plaintextSize === 0
      ? Readable.from([])
      : (await storage.getStream("vault", key, { start: STREAM_HEADER_BYTES, end: size - STREAM_TAG_BYTES - 1 })).pipe(createDecryptStream(key, parseStreamHeader(header), tag));
  const name = fileName.slice(0, 200) || "file";
  const asciiName = name.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return new Response(Readable.toWeb(body) as ReadableStream<Uint8Array>, {
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Length": String(plaintextSize),
      "Content-Disposition": `attachment; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(name)}`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
