import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { getServerSession } from "next-auth";
import { prisma } from "@marketplace/database";
import { hasAnyRole, hasPermission, type Permission, type UserRoleValue } from "@marketplace/shared-types";
import { getAuthOptions } from "./options";

export interface CurrentUser {
  id: string;
  email: string;
  name: string | null;
  image: string | null;
  role: UserRoleValue;
  emailVerified: Date | null;
  twoFactorEnabled: boolean;
  hasPassword: boolean;
}

/**
 * The signed-in user, re-read from the database once per request. The JWT
 * only says who is asking; role, suspension and session revocation are
 * always decided by the current database row, never by claims in the cookie.
 */
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  // Opt out of static rendering before any configuration is read, so
  // `next build` never evaluates auth settings (or needs secrets).
  await connection();
  const session = await getServerSession(getAuthOptions());
  const id = session?.user?.id;
  if (!session || !id) return null;

  const user = await prisma.user.findUnique({
    where: { id },
    select: {
      id: true,
      email: true,
      name: true,
      image: true,
      role: true,
      emailVerified: true,
      twoFactorEnabled: true,
      hashedPassword: true,
      isSuspended: true,
      sessionVersion: true,
    },
  });
  if (!user || user.isSuspended || user.sessionVersion !== session.sessionVersion) return null;

  return {
    id: user.id,
    email: user.email,
    name: user.name,
    image: user.image,
    role: user.role,
    emailVerified: user.emailVerified,
    twoFactorEnabled: user.twoFactorEnabled,
    hasPassword: user.hashedPassword !== null,
  };
});

/**
 * `reauth=1` tells the middleware not to bounce this visitor back to the app:
 * their cookie may still look valid at the edge while the database has
 * revoked the session (password change, suspension).
 */
function loginUrl(returnTo: string): string {
  return `/login?reauth=1&callbackUrl=${encodeURIComponent(returnTo)}`;
}

/** For pages and layouts: send anonymous visitors to sign in. */
export async function requireUser(returnTo: string): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) redirect(loginUrl(returnTo));
  return user;
}

export async function requireRole(roles: readonly UserRoleValue[], returnTo: string): Promise<CurrentUser> {
  const user = await requireUser(returnTo);
  if (!hasAnyRole(user.role, roles)) redirect("/forbidden");
  return user;
}

export async function requirePermission(permission: Permission, returnTo: string): Promise<CurrentUser> {
  const user = await requireUser(returnTo);
  if (!hasPermission(user.role, permission)) redirect("/forbidden");
  return user;
}

export type Authorization =
  | { ok: true; user: CurrentUser }
  | { ok: false; code: "UNAUTHORIZED" | "FORBIDDEN"; message: string };

/**
 * For server actions and route handlers, which answer with an error instead
 * of redirecting. Pass a permission to check authorisation as well.
 */
export async function authorize(permission?: Permission): Promise<Authorization> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, code: "UNAUTHORIZED", message: "Your session has expired. Sign in again." };
  if (permission && !hasPermission(user.role, permission)) {
    return { ok: false, code: "FORBIDDEN", message: "You do not have permission to do that." };
  }
  return { ok: true, user };
}
