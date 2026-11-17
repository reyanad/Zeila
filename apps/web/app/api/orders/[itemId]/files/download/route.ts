import { Readable } from "node:stream";
import { CheckoutError, orderItemForUser } from "@marketplace/core";
import { attachmentPrefix } from "@/lib/attachments";
import { getCurrentUser } from "@/lib/auth/session";
import { createDecryptStream, parseStreamHeader, STREAM_HEADER_BYTES, STREAM_TAG_BYTES } from "@/lib/crypto/stream";
import { getStorage } from "@/lib/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function readAll(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk as Uint8Array));
  return Buffer.concat(chunks);
}

/** Download an order-item file; only the buyer and the seller of the item may. */
export async function GET(request: Request, { params }: { params: Promise<{ itemId: string }> }): Promise<Response> {
  const { itemId } = await params;
  const url = new URL(request.url);
  const key = url.searchParams.get("key") ?? "";
  const name = (url.searchParams.get("name") ?? "file").slice(0, 200);
  const user = await getCurrentUser();
  if (!user) return new Response("Sign in to download this file.", { status: 401 });
  try {
    await orderItemForUser(user.id, itemId);
  } catch (error) {
    if (error instanceof CheckoutError) return new Response("Not found", { status: 404 });
    throw error;
  }
  if (!key.startsWith(`${attachmentPrefix(itemId)}/`) || key.includes("..")) return new Response("Not found", { status: 404 });

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
