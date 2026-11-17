import { NextResponse } from "next/server";
import { AFFILIATE_COOKIE, AFFILIATE_WINDOW_DAYS, recordAffiliateClick } from "@marketplace/core";
import { rateLimit } from "@/lib/rate-limit";
import { clientIpFromHeaders, isSameOrigin } from "@/lib/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Remember the referring affiliate for the attribution window (last click wins). */
export async function POST(request: Request): Promise<Response> {
  if (!isSameOrigin(request)) return Response.json({ ok: false }, { status: 403 });
  let code = "";
  try {
    const body = (await request.json()) as { code?: unknown };
    code = typeof body.code === "string" ? body.code : "";
  } catch {
    return Response.json({ ok: false }, { status: 400 });
  }
  const existing = request.headers.get("cookie")?.match(new RegExp(`(?:^|; )${AFFILIATE_COOKIE}=([^;]+)`))?.[1] ?? null;
  if (existing && existing.toUpperCase() === code.toUpperCase()) return Response.json({ ok: true });
  const limit = await rateLimit(`affiliate-click:${clientIpFromHeaders(request.headers)}`, 30, 60 * 60);
  if (!limit.allowed) return Response.json({ ok: false }, { status: 429 });
  const accepted = await recordAffiliateClick(code);
  if (!accepted) return Response.json({ ok: false }, { status: 404 });
  const response = NextResponse.json({ ok: true });
  response.cookies.set(AFFILIATE_COOKIE, accepted, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: AFFILIATE_WINDOW_DAYS * 86_400,
  });
  return response;
}
