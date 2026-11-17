import { NextResponse } from "next/server";
import { CheckoutError, issueDownload } from "@marketplace/core";
import { getCurrentUser } from "@/lib/auth/session";
import { signTicket } from "@/lib/crypto/tokens";
import { appUrl, getEnv } from "@/lib/env";
import { describeRetry, rateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export interface DownloadTicket {
  grantId: string;
  vaultKey: string;
  fileName: string;
  sizeBytes: number;
}

/**
 * Buyer clicks "Download": check ownership and the download limit, then
 * redirect to a signed link that expires in SIGNED_URL_TTL_SECONDS.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ grantId: string }> }): Promise<Response> {
  const { grantId } = await params;
  const user = await getCurrentUser();
  if (!user) return NextResponse.redirect(appUrl(`/login?callbackUrl=${encodeURIComponent("/orders")}`));

  const limit = await rateLimit(`download:${user.id}`, 60, 60 * 60);
  if (!limit.allowed) return new Response(`Too many downloads. ${describeRetry(limit.retryAfterSeconds)}`, { status: 429 });

  try {
    const target = await issueDownload(user.id, grantId, new Date());
    const ticket: DownloadTicket = { grantId: target.grantId, vaultKey: target.vaultKey, fileName: target.fileName, sizeBytes: target.sizeBytes };
    const signed = signTicket("download-ticket", ticket, getEnv().SIGNED_URL_TTL_SECONDS);
    return NextResponse.redirect(appUrl(`/api/downloads/file?t=${encodeURIComponent(signed)}`));
  } catch (error) {
    if (error instanceof CheckoutError) return new Response(error.message, { status: 403 });
    throw error;
  }
}
