import { getCurrentUser } from "@/lib/auth/session";
import { canAccessDisputeFiles, disputeFilePrefix, signDisputeFile } from "@/lib/dispute-files";
import { describeRetry, rateLimit } from "@/lib/rate-limit";
import { isSameOrigin } from "@/lib/request";
import { streamIntoVault } from "@/lib/vault-upload";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const MAX_EVIDENCE_BYTES = 25 * 1024 * 1024;

/** Upload evidence (photos, screenshots, documents) for a dispute on a sub-order. */
export async function POST(request: Request): Promise<Response> {
  if (!isSameOrigin(request)) return Response.json({ error: "Cross-site request refused" }, { status: 403 });
  const subOrderId = new URL(request.url).searchParams.get("subOrderId") ?? "";
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Sign in again." }, { status: 401 });
  if (!subOrderId || !(await canAccessDisputeFiles(user, subOrderId))) return Response.json({ error: "Not found" }, { status: 404 });
  const limit = await rateLimit(`dispute-upload:${user.id}`, 30, 60 * 60);
  if (!limit.allowed) return Response.json({ error: `Too many uploads. ${describeRetry(limit.retryAfterSeconds)}` }, { status: 429 });
  const result = await streamIntoVault(request, disputeFilePrefix(subOrderId), MAX_EVIDENCE_BYTES);
  if (!result.ok) return Response.json({ error: result.message }, { status: result.status });
  const file = { key: result.upload.vaultKey, fileName: result.upload.fileName, sizeBytes: result.upload.sizeBytes };
  return Response.json({ ...file, token: signDisputeFile(subOrderId, file) });
}
