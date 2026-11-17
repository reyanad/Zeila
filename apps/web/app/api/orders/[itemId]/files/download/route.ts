import { CheckoutError, orderItemForUser } from "@marketplace/core";
import { attachmentPrefix } from "@/lib/attachments";
import { getCurrentUser } from "@/lib/auth/session";
import { vaultDownloadResponse } from "@/lib/vault-download";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Download an order-item file; only the buyer and the seller of the item may. */
export async function GET(request: Request, { params }: { params: Promise<{ itemId: string }> }): Promise<Response> {
  const { itemId } = await params;
  const url = new URL(request.url);
  const key = url.searchParams.get("key") ?? "";
  const user = await getCurrentUser();
  if (!user) return new Response("Sign in to download this file.", { status: 401 });
  try {
    await orderItemForUser(user.id, itemId);
  } catch (error) {
    if (error instanceof CheckoutError) return new Response("Not found", { status: 404 });
    throw error;
  }
  if (!key.startsWith(`${attachmentPrefix(itemId)}/`) || key.includes("..")) return new Response("Not found", { status: 404 });
  return vaultDownloadResponse(key, url.searchParams.get("name") ?? "file");
}
