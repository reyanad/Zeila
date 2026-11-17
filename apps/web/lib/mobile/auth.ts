import "server-only";
import { prisma, type UserRole } from "@marketplace/database";
import { randomToken, sha256Hex } from "@/lib/crypto/tokens";

/**
 * Bearer sessions for the mobile app. The app keeps the token in the device's
 * secure storage; the server stores only its SHA-256. Sessions die with a
 * password change, "sign out everywhere" or a suspension (sessionVersion).
 */

const SESSION_DAYS = 60;
const TOUCH_INTERVAL_MS = 5 * 60_000;

export interface MobileUser {
  id: string;
  email: string;
  name: string | null;
  role: UserRole;
  sessionId: string;
}

export async function issueMobileSession(user: { id: string; sessionVersion: number }, deviceName: string | null): Promise<string> {
  const token = randomToken(32);
  await prisma.mobileSession.create({
    data: {
      userId: user.id,
      tokenHash: sha256Hex(token),
      sessionVersion: user.sessionVersion,
      deviceName: deviceName?.slice(0, 80) ?? null,
      expiresAt: new Date(Date.now() + SESSION_DAYS * 86_400_000),
    },
  });
  return token;
}

function bearer(request: Request): string | null {
  const header = request.headers.get("authorization") ?? "";
  const match = /^Bearer\s+([A-Za-z0-9_-]{20,200})$/.exec(header.trim());
  return match?.[1] ?? null;
}

export async function mobileUser(request: Request): Promise<MobileUser | null> {
  const token = bearer(request);
  if (!token) return null;
  const session = await prisma.mobileSession.findUnique({
    where: { tokenHash: sha256Hex(token) },
    select: { id: true, sessionVersion: true, expiresAt: true, revokedAt: true, lastUsedAt: true, user: { select: { id: true, email: true, name: true, role: true, isSuspended: true, sessionVersion: true } } },
  });
  const now = Date.now();
  if (!session || session.revokedAt || session.expiresAt.getTime() <= now) return null;
  if (session.user.isSuspended || session.user.sessionVersion !== session.sessionVersion) return null;
  if (now - session.lastUsedAt.getTime() > TOUCH_INTERVAL_MS) {
    await prisma.mobileSession.update({ where: { id: session.id }, data: { lastUsedAt: new Date(now) } });
  }
  return { id: session.user.id, email: session.user.email, name: session.user.name, role: session.user.role, sessionId: session.id };
}

export async function revokeMobileSession(sessionId: string): Promise<void> {
  await prisma.mobileSession.updateMany({ where: { id: sessionId, revokedAt: null }, data: { revokedAt: new Date() } });
}

export function json(data: unknown, status = 200): Response {
  return Response.json(data, { status, headers: { "Cache-Control": "no-store" } });
}

export function unauthorized(): Response {
  return json({ error: "Sign in again." }, 401);
}

/** Run a handler for a signed-in mobile user. */
export async function withMobileUser(request: Request, handler: (user: MobileUser) => Promise<Response>): Promise<Response> {
  const user = await mobileUser(request);
  if (!user) return unauthorized();
  return handler(user);
}
