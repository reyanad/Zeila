import { NextResponse, type NextRequest } from "next/server";
import { getToken } from "next-auth/jwt";

/**
 * Coarse routing guard at the edge. It only decides "signed in or not" and
 * keeps non-staff out of /admin; every page and server action re-checks the
 * live database row (role, suspension, revoked sessions) before doing work.
 */

const STAFF_ROLES = new Set(["MODERATOR", "SUPER_ADMIN"]);
const AUTH_PAGES = new Set(["/login", "/register", "/forgot-password"]);

export async function middleware(request: NextRequest): Promise<NextResponse> {
  const { pathname, search } = request.nextUrl;
  const token = await getToken({ req: request, secret: process.env.AUTH_SECRET });
  const signedIn = Boolean(token?.uid);

  if (AUTH_PAGES.has(pathname)) {
    // Only bounce when no error is being shown, so a revoked session can still sign in again.
    if (signedIn && !request.nextUrl.searchParams.has("error") && !request.nextUrl.searchParams.has("reauth")) {
      return NextResponse.redirect(new URL("/account", request.url));
    }
    return NextResponse.next();
  }

  if (!signedIn) {
    const login = new URL("/login", request.url);
    login.searchParams.set("callbackUrl", `${pathname}${search}`);
    return NextResponse.redirect(login);
  }

  if (pathname.startsWith("/admin") && !STAFF_ROLES.has(token?.role ?? "")) {
    return NextResponse.redirect(new URL("/forbidden", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/account/:path*",
    "/seller/:path*",
    "/admin/:path*",
    "/checkout/:path*",
    "/orders/:path*",
    "/login",
    "/register",
    "/forgot-password",
  ],
};
