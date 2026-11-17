import "server-only";
import { redirect } from "next/navigation";
import { prisma } from "@marketplace/database";
import { hasPermission } from "@marketplace/shared-types";
import { requireUser, type CurrentUser } from "@/lib/auth/session";
import { publicAssetUrl } from "@/lib/env";

export interface StudioContext {
  user: CurrentUser;
  store: { id: string; name: string; slug: string; status: string; currency: string };
}

/** For Vendor Studio pages: a signed-in seller with a store, or a redirect to setup. */
export async function requireStudio(returnTo: string): Promise<StudioContext> {
  const user = await requireUser(returnTo);
  if (!hasPermission(user.role, "listing:manage")) redirect("/seller/onboarding");
  const store = await prisma.store.findUnique({
    where: { sellerId: user.id },
    select: { id: true, name: true, slug: true, status: true, currency: true },
  });
  if (!store) redirect("/seller/onboarding");
  if (store.status === "SUSPENDED" || store.status === "CLOSED") redirect("/seller/onboarding");
  return { user, store };
}

export async function warehouseOptions(storeId: string): Promise<Array<{ id: string; name: string }>> {
  return prisma.warehouse.findMany({
    where: { storeId },
    orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
    select: { id: true, name: true },
  });
}

/** Active categories as select options, labelled with their path ("Fashion › Scarves"). */
export async function categoryOptions(): Promise<Array<{ value: string; label: string }>> {
  const categories = await prisma.category.findMany({
    where: { isActive: true },
    orderBy: [{ path: "asc" }],
    select: { id: true, name: true, parentId: true },
  });
  const byId = new Map(categories.map((category) => [category.id, category]));
  const label = (id: string): string => {
    const parts: string[] = [];
    let current = byId.get(id);
    let guard = 0;
    while (current && guard < 6) {
      parts.unshift(current.name);
      current = current.parentId ? byId.get(current.parentId) : undefined;
      guard += 1;
    }
    return parts.join(" › ");
  };
  return categories.map((category) => ({ value: category.id, label: label(category.id) })).sort((a, b) => a.label.localeCompare(b.label));
}

export function imageUrlMap(keys: readonly string[]): Record<string, string> {
  return Object.fromEntries(keys.map((key) => [key, publicAssetUrl(key)]));
}
