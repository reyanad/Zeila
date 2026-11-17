import { prisma } from "@marketplace/database";
import { hasPermission, kycDocumentSchema } from "@marketplace/shared-types";
import { recordAudit } from "@/lib/audit";
import { getCurrentUser } from "@/lib/auth/session";
import { getClientIp } from "@/lib/request";
import { getVaultObject } from "@/lib/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Show one identity document to a reviewer. Every view is audited. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string; index: string }> }): Promise<Response> {
  const { id, index } = await params;
  const user = await getCurrentUser();
  if (!user || !hasPermission(user.role, "kyc:review")) return new Response("Not found", { status: 404 });
  const submission = await prisma.kycSubmission.findUnique({ where: { id }, select: { documents: true } });
  const documents = Array.isArray(submission?.documents) ? submission.documents : [];
  const parsed = kycDocumentSchema.safeParse(documents[Number.parseInt(index, 10)]);
  if (!parsed.success) return new Response("Not found", { status: 404 });
  const bytes = await getVaultObject(parsed.data.storageKey);
  if (!bytes) return new Response("Not found", { status: 404 });
  await recordAudit({ actorId: user.id, action: "kyc.document.view", entity: "KycSubmission", entityId: id, data: { kind: parsed.data.kind }, ipAddress: await getClientIp() });
  return new Response(new Uint8Array(bytes), {
    headers: {
      "Content-Type": parsed.data.contentType,
      "Content-Length": String(bytes.length),
      "Content-Disposition": "inline",
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox",
      "Referrer-Policy": "no-referrer",
    },
  });
}
