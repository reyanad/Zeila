import { getCurrentUser } from "@/lib/auth/session";
import { canAccessDisputeFiles, disputeFilePrefix } from "@/lib/dispute-files";
import { vaultDownloadResponse } from "@/lib/vault-download";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const subOrderId = url.searchParams.get("subOrderId") ?? "";
  const key = url.searchParams.get("key") ?? "";
  const user = await getCurrentUser();
  if (!user) return new Response("Sign in to download this file.", { status: 401 });
  if (!subOrderId || !(await canAccessDisputeFiles(user, subOrderId))) return new Response("Not found", { status: 404 });
  if (!key.startsWith(`${disputeFilePrefix(subOrderId)}/`) || key.includes("..")) return new Response("Not found", { status: 404 });
  return vaultDownloadResponse(key, url.searchParams.get("name") ?? "file");
}
