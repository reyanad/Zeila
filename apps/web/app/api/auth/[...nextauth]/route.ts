import type { NextRequest } from "next/server";
import NextAuth from "next-auth";
import { getAuthOptions } from "@/lib/auth/options";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ nextauth: string[] }>;
}

// Options are built per request (lazily) so the build never needs secrets.
async function handler(request: NextRequest, context: RouteContext): Promise<Response> {
  return (await NextAuth(request, context, getAuthOptions())) as Response;
}

export { handler as GET, handler as POST };
