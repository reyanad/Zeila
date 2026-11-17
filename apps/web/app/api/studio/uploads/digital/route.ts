import { prisma } from "@marketplace/database";
import { authorize } from "@/lib/auth/session";
import { signTicket } from "@/lib/crypto/tokens";
import { digitalUploadMaxBytes } from "@/lib/env";
import { describeRetry, rateLimit } from "@/lib/rate-limit";
import { isSameOrigin } from "@/lib/request";
import type { UploadTicket } from "@/lib/studio/listings";
import { streamIntoVault } from "@/lib/vault-upload";

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

  const result = await streamIntoVault(request, `digital/${store.id}`, digitalUploadMaxBytes());
  if (!result.ok) return Response.json({ error: result.message }, { status: result.status });
  const { vaultKey, fileName, sizeBytes, checksumSha256 } = result.upload;

  const ticket: UploadTicket = { storeId: store.id, vaultKey, fileName, sizeBytes, checksumSha256 };
  return Response.json({
    vaultKey,
    fileName,
    sizeBytes: ticket.sizeBytes,
    checksumSha256: ticket.checksumSha256,
    token: signTicket("upload-ticket", ticket, TICKET_TTL_SECONDS),
  });
}
