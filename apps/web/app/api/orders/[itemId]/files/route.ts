import { CheckoutError, orderItemForUser } from "@marketplace/core";
import { signAttachment, attachmentPrefix } from "@/lib/attachments";
import { getCurrentUser } from "@/lib/auth/session";
import { describeRetry, rateLimit } from "@/lib/rate-limit";
import { isSameOrigin } from "@/lib/request";
import { streamIntoVault } from "@/lib/vault-upload";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 600;

const MAX_ATTACHMENT_BYTES = 200 * 1024 * 1024;

/** Upload a file for an order item (seller deliverables, buyer intake files). */
export async function POST(request: Request, { params }: { params: Promise<{ itemId: string }> }): Promise<Response> {
  if (!isSameOrigin(request)) return Response.json({ error: "Cross-site request refused" }, { status: 403 });
  const { itemId } = await params;
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Sign in again." }, { status: 401 });
  try {
    await orderItemForUser(user.id, itemId);
  } catch (error) {
    if (error instanceof CheckoutError) return Response.json({ error: error.message }, { status: 404 });
    throw error;
  }
  const limit = await rateLimit(`attachment-upload:${user.id}`, 60, 60 * 60);
  if (!limit.allowed) return Response.json({ error: `Too many uploads. ${describeRetry(limit.retryAfterSeconds)}` }, { status: 429 });

  const result = await streamIntoVault(request, attachmentPrefix(itemId), MAX_ATTACHMENT_BYTES);
  if (!result.ok) return Response.json({ error: result.message }, { status: result.status });
  const file = { key: result.upload.vaultKey, fileName: result.upload.fileName, sizeBytes: result.upload.sizeBytes };
  return Response.json({ ...file, token: signAttachment(itemId, file) });
}
