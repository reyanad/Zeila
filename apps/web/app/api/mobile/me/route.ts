import { unreadConversationCount } from "@marketplace/core";
import { prisma } from "@marketplace/database";
import { json, withMobileUser } from "@/lib/mobile/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  return withMobileUser(request, async (user) => {
    const [unreadMessages, unreadNotifications, store] = await Promise.all([
      unreadConversationCount(user.id),
      prisma.notification.count({ where: { userId: user.id, readAt: null } }),
      prisma.store.findUnique({ where: { sellerId: user.id }, select: { name: true, slug: true, status: true } }),
    ]);
    return json({ user: { id: user.id, email: user.email, name: user.name, role: user.role }, store, unreadMessages, unreadNotifications });
  });
}
