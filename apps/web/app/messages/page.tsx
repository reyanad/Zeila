import type { Metadata } from "next";
import Link from "next/link";
import { prisma } from "@marketplace/database";
import { requireUser } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Messages", robots: { index: false } };
export const dynamic = "force-dynamic";

export default async function MessagesPage() {
  const user = await requireUser("/messages");
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

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-8">
      <h1 className="text-2xl font-semibold tracking-tight">Messages</h1>
      {rows.length === 0 ? (
        <p className="rounded-md border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
          No conversations yet. Use “Message the seller” on a listing to ask a question.
        </p>
      ) : (
        <ul className="flex flex-col divide-y divide-border rounded-md border border-border">
          {rows.map(({ conversation, lastReadAt }) => {
            const iAmBuyer = conversation.pairKey?.startsWith(`${user.id}:`) ?? false;
            const title = iAmBuyer ? (conversation.subject ?? "Seller") : (conversation.participants[0]?.user.name ?? "Buyer");
            const last = conversation.messages[0];
            const unread = last !== undefined && last.senderId !== user.id && (!lastReadAt || last.createdAt > lastReadAt);
            const preview = last ? (last.kind === "SERVICE_OFFER" ? `Custom offer: ${last.body ?? ""}` : (last.body ?? "")) : "No messages yet";
            return (
              <li key={conversation.id}>
                <Link href={`/messages/${conversation.id}`} className="flex items-center justify-between gap-3 p-4 hover:bg-accent">
                  <div className="flex min-w-0 flex-col">
                    <span className={unread ? "font-semibold" : "font-medium"}>
                      {title}
                      {iAmBuyer ? null : <span className="ml-2 text-xs font-normal text-muted-foreground">buyer</span>}
                    </span>
                    <span className="truncate text-sm text-muted-foreground">{preview}</span>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <time className="text-xs text-muted-foreground" dateTime={conversation.updatedAt.toISOString()}>
                      {conversation.updatedAt.toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
                    </time>
                    {unread ? <span className="h-2 w-2 rounded-full bg-primary" aria-label="Unread" /> : null}
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
