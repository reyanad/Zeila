import { Readable } from "node:stream";
import { createDecryptStream, parseStreamHeader, STREAM_HEADER_BYTES, STREAM_TAG_BYTES } from "@/lib/crypto/stream";
import { verifyTicket } from "@/lib/crypto/tokens";
import { getStorage } from "@/lib/storage";
import type { DownloadTicket } from "../[grantId]/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function readAll(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk as Uint8Array));
  return Buffer.concat(chunks);
}

/** Stream a vault file to whoever holds a valid, unexpired signed link. */
export async function GET(request: Request): Promise<Response> {
  const token = new URL(request.url).searchParams.get("t") ?? "";
  const ticket = verifyTicket<DownloadTicket>("download-ticket", token);
  if (!ticket) return new Response("This download link has expired. Go back to your order and click Download again.", { status: 410 });

  const storage = getStorage();
  const size = await storage.size("vault", ticket.vaultKey);
  if (size === null || size < STREAM_HEADER_BYTES + STREAM_TAG_BYTES) return new Response("File not found", { status: 404 });

  const header = await readAll(await storage.getStream("vault", ticket.vaultKey, { start: 0, end: STREAM_HEADER_BYTES - 1 }));
  const tag = await readAll(await storage.getStream("vault", ticket.vaultKey, { start: size - STREAM_TAG_BYTES, end: size - 1 }));
  const plaintextSize = size - STREAM_HEADER_BYTES - STREAM_TAG_BYTES;
  const body =
    plaintextSize === 0
      ? Readable.from([])
      : (await storage.getStream("vault", ticket.vaultKey, { start: STREAM_HEADER_BYTES, end: size - STREAM_TAG_BYTES - 1 })).pipe(
          createDecryptStream(ticket.vaultKey, parseStreamHeader(header), tag),
        );

  const asciiName = ticket.fileName.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return new Response(Readable.toWeb(body) as ReadableStream<Uint8Array>, {
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Length": String(plaintextSize),
      "Content-Disposition": `attachment; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(ticket.fileName)}`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
