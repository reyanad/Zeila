import "server-only";
import { redirect } from "next/navigation";
import { hasPermission, type Permission } from "@marketplace/shared-types";
import { requireUser, type CurrentUser } from "@/lib/auth/session";

/** Admin pages: a signed-in user holding `permission`, otherwise the forbidden page. */
export async function requirePermission(permission: Permission, returnTo: string): Promise<CurrentUser> {
  const user = await requireUser(returnTo);
  if (!hasPermission(user.role, permission)) redirect("/forbidden");
  return user;
}
