import { CheckoutError, markConversationRead, parseOffer, postMessage } from "@marketplace/core";
import { prisma } from "@marketplace/database";
import { absoluteUrl } from "@/lib/env";
import { json, withMobileUser } from "@/lib/mobile/auth";
import { rateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await params;
  return withMobileUser(request, async (user) => {
    const conversation = await prisma.conversation.findFirst({
      where: { id, participants: { some: { userId: user.id } } },
      select: {
        id: true,
        subject: true,
        pairKey: true,
        participants: { where: { userId: { not: user.id } }, select: { user: { select: { name: true } } } },
        messages: { orderBy: { createdAt: "desc" }, take: 100, select: { id: true, senderId: true, kind: true, body: true, offerPayload: true, flaggedCircumvention: true, createdAt: true } },
      },
    });
    if (!conversation) return json({ error: "Not found" }, 404);
    await markConversationRead(user.id, conversation.id, new Date());
    const iAmBuyer = conversation.pairKey?.startsWith(`${user.id}:`) ?? false;
    return json({
      id: conversation.id,
      title: iAmBuyer ? (conversation.subject ?? "Seller") : (conversation.participants[0]?.user.name ?? "Buyer"),
      webUrl: absoluteUrl(`/messages/${conversation.id}`),
      messages: [...conversation.messages].reverse().map((message) => ({
        id: message.id,
        mine: message.senderId === user.id,
        kind: message.kind,
        body: message.body,
        flagged: message.flaggedCircumvention,
        offer: message.kind === "SERVICE_OFFER" ? parseOffer(message.offerPayload) : null,
        createdAt: message.createdAt.toISOString(),
      })),
    });
  });
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await params;
  return withMobileUser(request, async (user) => {
    const limit = await rateLimit(`message:${user.id}`, 30, 60);
    if (!limit.allowed) return json({ error: "You are sending messages too quickly." }, 429);
    const body = (await request.json().catch(() => ({}))) as { body?: unknown };
    try {
      const posted = await postMessage(user.id, id, typeof body.body === "string" ? body.body : "", new Date());
      return json({ ok: true, flagged: posted.flagged });
    } catch (error) {
      if (error instanceof CheckoutError) return json({ error: error.message }, 400);
      throw error;
    }
  });
}
