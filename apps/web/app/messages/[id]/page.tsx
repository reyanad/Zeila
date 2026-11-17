import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { parseOffer } from "@marketplace/core";
import { prisma } from "@marketplace/database";
import { Alert } from "@marketplace/ui";
import { Composer } from "@/components/messages/composer";
import { OfferCard } from "@/components/messages/offer-card";
import { OfferComposer } from "@/components/messages/offer-composer";
import { ThreadLive } from "@/components/messages/thread-live";
import { formatPrice } from "@/components/storefront/price";
import { requireUser } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Conversation", robots: { index: false } };
export const dynamic = "force-dynamic";

export default async function ConversationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser(`/messages/${id}`);
  const conversation = await prisma.conversation.findFirst({
    where: { id, participants: { some: { userId: user.id } } },
    select: {
      id: true,
      subject: true,
      pairKey: true,
      listingId: true,
      participants: { select: { userId: true, lastReadAt: true, user: { select: { name: true } } } },
      messages: { orderBy: { createdAt: "desc" }, take: 200, select: { id: true, senderId: true, kind: true, body: true, offerPayload: true, flaggedCircumvention: true, createdAt: true } },
    },
  });
  if (!conversation) notFound();
  const iAmSeller = conversation.pairKey?.endsWith(`:${user.id}`) ?? false;
  const other = conversation.participants.find((participant) => participant.userId !== user.id);
  const otherName = iAmSeller ? (other?.user.name ?? "Buyer") : (conversation.subject ?? "Seller");
  const [listing, store] = await Promise.all([
    conversation.listingId ? prisma.listing.findUnique({ where: { id: conversation.listingId }, select: { title: true, slug: true } }) : null,
    iAmSeller ? prisma.store.findUnique({ where: { sellerId: user.id }, select: { currency: true, listings: { where: { type: "SERVICE", status: "ACTIVE" }, select: { id: true, title: true }, orderBy: { updatedAt: "desc" }, take: 50 } } }) : null,
  ]);
  const messages = [...conversation.messages].reverse();
  const now = new Date();
  const seenByOther = other?.lastReadAt ?? null;

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-4 py-8">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-xl font-semibold tracking-tight">{otherName}</h1>
        {listing ? (
          <Link href={`/listing/${listing.slug}`} className="text-sm text-muted-foreground hover:underline">
            About: {listing.title}
          </Link>
        ) : null}
      </div>
      <ol className="flex flex-col gap-3" aria-label="Messages">
        {messages.length === 0 ? <li className="text-sm text-muted-foreground">Say hello and ask your question.</li> : null}
        {messages.map((message) => {
          const mine = message.senderId === user.id;
          const offer = message.kind === "SERVICE_OFFER" ? parseOffer(message.offerPayload) : null;
          return (
            <li key={message.id} className={`flex flex-col gap-1 ${mine ? "items-end" : "items-start"}`}>
              {offer ? (
                <div className="w-full max-w-md">
                  <OfferCard
                    conversationId={conversation.id}
                    messageId={message.id}
                    offer={offer}
                    price={formatPrice(offer.price, offer.currency)}
                    mine={mine}
                    expired={new Date(offer.expiresAt) <= now}
                  />
                </div>
              ) : (
                <div className={`max-w-[85%] whitespace-pre-wrap rounded-2xl px-4 py-2 text-sm ${mine ? "bg-primary text-primary-foreground" : "bg-muted"}`}>{message.body}</div>
              )}
              {message.flaggedCircumvention ? (
                <p className="max-w-[85%] text-xs text-amber-700 dark:text-amber-400">
                  This message mentioned contact details or paying outside the platform. Payments made outside are not protected by escrow.
                </p>
              ) : null}
              <span className="text-[11px] text-muted-foreground">
                {message.createdAt.toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                {mine && seenByOther && seenByOther >= message.createdAt ? " · Seen" : ""}
              </span>
            </li>
          );
        })}
      </ol>
      <ThreadLive conversationId={conversation.id} />
      {iAmSeller && store ? <OfferComposer conversationId={conversation.id} services={store.listings} currency={store.currency} /> : null}
      <Composer conversationId={conversation.id} />
      <Alert tone="info">Keep conversations and payments here. Sharing phone numbers, e-mails or payment links is blocked to protect both sides.</Alert>
    </div>
  );
}
