"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@marketplace/database";
import { getCurrentUser } from "@/lib/auth/session";

export async function markAllNotificationsReadAction(): Promise<void> {
  const user = await getCurrentUser();
  if (!user) return;
  await prisma.notification.updateMany({ where: { userId: user.id, readAt: null }, data: { readAt: new Date() } });
  revalidatePath("/notifications");
}

export async function setEmailNotificationsAction(enabled: boolean): Promise<{ ok: boolean }> {
  const user = await getCurrentUser();
  if (!user) return { ok: false };
  await prisma.user.update({ where: { id: user.id }, data: { emailNotifications: enabled } });
  revalidatePath("/notifications");
  return { ok: true };
}
