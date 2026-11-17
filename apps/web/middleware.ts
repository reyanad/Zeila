import { NextResponse, type NextRequest } from "next/server";
import { getToken } from "next-auth/jwt";
import { contentSecurityPolicy } from "@/lib/security/csp";

/**
 * Runs for every page:
 * - sets a per-request nonce and the Content Security Policy (Next.js applies
 *   the nonce to its scripts during rendering);
 * - a coarse sign-in guard for private areas and staff-only /admin. Every page
 *   and server action re-checks the live database row (role, suspension,
 *   revoked sessions) before doing work.
 */

const STAFF_ROLES = new Set(["MODERATOR", "SUPER_ADMIN"]);
const AUTH_PAGES = new Set(["/login", "/register", "/forgot-password"]);
const PRIVATE_PREFIXES = ["/account", "/seller", "/admin", "/checkout", "/orders", "/messages", "/notifications", "/disputes", "/affiliates"];

function withSecurityHeaders(request: NextRequest, nonce: string, csp: string): NextResponse {
  const headers = new Headers(request.headers);
  headers.set("x-nonce", nonce);
  headers.set("Content-Security-Policy", csp);
  const response = NextResponse.next({ request: { headers } });
  response.headers.set("Content-Security-Policy", csp);
  return response;
}

export async function middleware(request: NextRequest): Promise<NextResponse> {
  const { pathname, search } = request.nextUrl;
  const nonce = btoa(crypto.randomUUID());
  const csp = contentSecurityPolicy(nonce, {
    production: process.env.NODE_ENV === "production",
    assetBaseUrl: process.env.PUBLIC_ASSET_BASE_URL,
    realtimeUrl: process.env.NEXT_PUBLIC_REALTIME_URL,
  });

  const isAuthPage = AUTH_PAGES.has(pathname);
  const isPrivate = PRIVATE_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
  if (!isAuthPage && !isPrivate) return withSecurityHeaders(request, nonce, csp);

  const token = await getToken({ req: request, secret: process.env.AUTH_SECRET });
  const signedIn = Boolean(token?.uid);

  if (isAuthPage) {
    // Only bounce when no error is being shown, so a revoked session can still sign in again.
    if (signedIn && !request.nextUrl.searchParams.has("error") && !request.nextUrl.searchParams.has("reauth")) {
      return NextResponse.redirect(new URL("/account", request.url));
    }
    return withSecurityHeaders(request, nonce, csp);
  }

  if (!signedIn) {
    const login = new URL("/login", request.url);
    login.searchParams.set("callbackUrl", `${pathname}${search}`);
    return NextResponse.redirect(login);
  }

  if (pathname.startsWith("/admin") && !STAFF_ROLES.has(token?.role ?? "")) {
    return NextResponse.redirect(new URL("/forbidden", request.url));
  }

  return withSecurityHeaders(request, nonce, csp);
}

export const config = {
  // Every page; not API routes, Next.js assets or static files (they carry their own headers).
  matcher: ["/((?!api/|_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml|.*\\.(?:png|jpg|jpeg|gif|webp|svg|ico|txt|xml)$).*)"],
};
