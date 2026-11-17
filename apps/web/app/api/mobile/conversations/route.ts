import { CheckoutError, openConversation } from "@marketplace/core";
import { prisma } from "@marketplace/database";
import { json, withMobileUser } from "@/lib/mobile/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  return withMobileUser(request, async (user) => {
    const rows = await prisma.conversationParticipant.findMany({
      where: { userId: user.id },
      orderBy: { conversation: { updatedAt: "desc" } },
      take: 100,
      select: {
        lastReadAt: true,
        conversation: {
          select: {
            id: true,
            subject: true,
            pairKey: true,
            updatedAt: true,
            participants: { where: { userId: { not: user.id } }, select: { user: { select: { name: true } } } },
            messages: { orderBy: { createdAt: "desc" }, take: 1, select: { body: true, kind: true, senderId: true, createdAt: true } },
          },
        },
      },
    });
    return json({
      items: rows.map(({ conversation, lastReadAt }) => {
        const iAmBuyer = conversation.pairKey?.startsWith(`${user.id}:`) ?? false;
        const last = conversation.messages[0];
        return {
          id: conversation.id,
          title: iAmBuyer ? (conversation.subject ?? "Seller") : (conversation.participants[0]?.user.name ?? "Buyer"),
          preview: last ? (last.kind === "SERVICE_OFFER" ? `Custom offer: ${last.body ?? ""}` : (last.body ?? "")) : "",
          updatedAt: conversation.updatedAt.toISOString(),
          unread: last !== undefined && last.senderId !== user.id && (!lastReadAt || last.createdAt > lastReadAt),
        };
      }),
    });
  });
}

/** "Message the seller" from the app: open (or reuse) the thread with a store. */
export async function POST(request: Request): Promise<Response> {
  return withMobileUser(request, async (user) => {
    const body = (await request.json().catch(() => ({}))) as { storeId?: unknown; listingId?: unknown };
    if (typeof body.storeId !== "string") return json({ error: "Choose a store." }, 400);
    try {
      const id = await openConversation(user.id, body.storeId, { listingId: typeof body.listingId === "string" ? body.listingId : null });
      return json({ id });
    } catch (error) {
      if (error instanceof CheckoutError) return json({ error: error.message }, 400);
      throw error;
    }
  });
}
