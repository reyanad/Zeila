import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@marketplace/database";
import { recordAudit } from "@/lib/audit";
import { consumeEmailToken } from "@/lib/auth/email-tokens";
import { appUrl } from "@/lib/env";
import { rateLimit } from "@/lib/rate-limit";
import { clientIpFromHeaders } from "@/lib/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Target of the confirmation link in the sign-up e-mail. */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const ip = clientIpFromHeaders(request.headers);
  const failure = NextResponse.redirect(appUrl("/login?error=VerificationExpired"));

  const limit = await rateLimit(`verify-email:${ip}`, 30, 60 * 60);
  if (!limit.allowed) return failure;

  const token = request.nextUrl.searchParams.get("token");
  if (!token) return failure;

  try {
    const userId = await consumeEmailToken("verify-email", token);
    if (!userId) return failure;
    await prisma.user.update({ where: { id: userId }, data: { emailVerified: new Date() } });
    await recordAudit({ actorId: userId, action: "auth.email.verify", entity: "User", entityId: userId, ipAddress: ip });
  } catch (error) {
    console.error("[auth] e-mail verification failed", error);
    return failure;
  }
  return NextResponse.redirect(appUrl("/login?notice=verified"));
}
