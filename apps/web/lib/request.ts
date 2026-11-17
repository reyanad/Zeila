import "server-only";
import { headers } from "next/headers";
import { getEnv } from "@/lib/env";

/**
 * Best-effort client IP for rate limiting and audit logs. Behind a proxy the
 * left-most `x-forwarded-for` entry is the client as reported by the edge;
 * deployments must make sure their proxy overwrites that header.
 */
export function clientIpFromHeaders(source: Headers): string {
  const forwarded = source.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first.slice(0, 64);
  }
  return source.get("x-real-ip")?.slice(0, 64) ?? "unknown";
}

export async function getClientIp(): Promise<string> {
  return clientIpFromHeaders(await headers());
}

/**
 * CSRF defence for cookie-authenticated route handlers (Server Actions get
 * the equivalent check from Next.js): the Origin header must match this app.
 */
export function isSameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  let originHost: string;
  try {
    originHost = new URL(origin).host;
  } catch {
    return false;
  }
  const allowed = new Set<string>([new URL(getEnv().NEXT_PUBLIC_APP_URL).host]);
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  if (host) allowed.add(host);
  return allowed.has(originHost);
}

/**
 * Only allow redirects back into this app: a relative path, never a
 * protocol-relative or absolute URL supplied by the client.
 */
export function safeRedirectPath(target: string | null | undefined, fallback = "/account"): string {
  if (!target) return fallback;
  if (!target.startsWith("/") || target.startsWith("//") || target.startsWith("/\\")) return fallback;
  if (target.startsWith("/api/")) return fallback;
  return target;
}
