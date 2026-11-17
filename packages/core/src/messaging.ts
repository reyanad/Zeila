import { prisma, type Prisma } from "@marketplace/database";
import { enqueueNotificationJob } from "@marketplace/jobs";
import { publishToUsers } from "@marketplace/realtime";
import {
  applyBps,
  CHECKOUT_HOLD_MINUTES,
  customOfferInputSchema,
  MESSAGE_MAX_LENGTH,
  offerPayloadSchema,
  screenMessage,
  type CustomOfferInput,
  type OfferPayload,
} from "@marketplace/shared-types";
import { parseShippingProfile } from "./catalog";
import { orderNumber } from "./checkout";
import { CheckoutError } from "./errors";
import { notify } from "./notifications";
import { priceCheckout } from "./pricing";
import { getSetting } from "./settings";

/**
 * Buyer–seller messaging: one thread per buyer and store, contact details
 * screened out of every message, and custom offers that turn into a normal
 * escrow-protected order when the buyer accepts.
 */

export async function openConversation(buyerId: string, storeId: string, context: { listingId?: string | null; orderId?: string | null }): Promise<string> {
  const store = await prisma.store.findUnique({ where: { id: storeId }, select: { sellerId: true, name: true, status: true } });
  if (!store || store.status === "SUSPENDED" || store.status === "CLOSED") throw new CheckoutError("This store is not available.");
  if (store.sellerId === buyerId) throw new CheckoutError("This is your own store.");
  const pairKey = `${buyerId}:${store.sellerId}`;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const conversation = await prisma.conversation.upsert({
        where: { pairKey },
        create: {
          pairKey,
          subject: store.name,
          listingId: context.listingId ?? null,
          orderId: context.orderId ?? null,
          participants: { create: [{ userId: buyerId }, { userId: store.sellerId }] },
        },
        update: { ...(context.listingId ? { listingId: context.listingId } : {}), ...(context.orderId ? { orderId: context.orderId } : {}) },
        select: { id: true },
      });
      return conversation.id;
    } catch (error) {
      const raced = typeof error === "object" && error !== null && "code" in error && error.code === "P2002";
      if (!raced || attempt === 1) throw error;
    }
  }
  throw new CheckoutError("Could not open the conversation.");
}

async function participants(userId: string, conversationId: string) {
  const conversation = await prisma.conversation.findFirst({
    where: { id: conversationId, participants: { some: { userId } } },
    select: { id: true, pairKey: true, participants: { select: { userId: true, user: { select: { name: true } } } } },
  });
  if (!conversation) throw new CheckoutError("That conversation does not exist.");
  return conversation;
}

export interface PostedMessage {
  id: string;
  flagged: boolean;
}

async function broadcast(conversationId: string, recipients: string[], everyone: string[], message: { id: string; senderId: string; kind: string; body: string | null; flaggedCircumvention: boolean; createdAt: Date }): Promise<void> {
  await publishToUsers(everyone, {
    type: "message",
    conversationId,
    message: { id: message.id, conversationId, senderId: message.senderId, kind: message.kind, body: message.body, flagged: message.flaggedCircumvention, createdAt: message.createdAt.toISOString() },
  });
  const redisUrl = process.env.REDIS_URL;
  if (redisUrl) {
    await Promise.all(
      recipients.flatMap((recipientId) => [
        enqueueNotificationJob(redisUrl, { kind: "message-push", messageId: message.id, recipientId }),
        enqueueNotificationJob(redisUrl, { kind: "message-email", conversationId, recipientId }),
      ]),
    );
  }
}

export async function postMessage(senderId: string, conversationId: string, body: string, now: Date): Promise<PostedMessage> {
  const trimmed = body.trim();
  if (!trimmed) throw new CheckoutError("Write a message first.");
  if (trimmed.length > MESSAGE_MAX_LENGTH) throw new CheckoutError(`Messages can be at most ${MESSAGE_MAX_LENGTH} characters.`);
  const conversation = await participants(senderId, conversationId);
  const screened = screenMessage(trimmed);
  const message = await prisma.$transaction(async (tx) => {
    const created = await tx.message.create({
      data: { conversationId, senderId, kind: "TEXT", body: screened.text, flaggedCircumvention: screened.flagged, createdAt: now },
      select: { id: true, senderId: true, kind: true, body: true, flaggedCircumvention: true, createdAt: true },
    });
    await tx.conversation.update({ where: { id: conversationId }, data: { updatedAt: now } });
    await tx.conversationParticipant.update({ where: { conversationId_userId: { conversationId, userId: senderId } }, data: { lastReadAt: now } });
    return created;
  });
  const everyone = conversation.participants.map((participant) => participant.userId);
  await broadcast(conversationId, everyone.filter((id) => id !== senderId), everyone, message);
  return { id: message.id, flagged: message.flaggedCircumvention };
}

export async function markConversationRead(userId: string, conversationId: string, now: Date): Promise<void> {
  const conversation = await participants(userId, conversationId);
  await prisma.conversationParticipant.update({ where: { conversationId_userId: { conversationId, userId } }, data: { lastReadAt: now } });
  await publishToUsers(
    conversation.participants.map((participant) => participant.userId).filter((id) => id !== userId),
    { type: "read", conversationId, userId, at: now.toISOString() },
  );
}

/** Unread conversations for the header badge. */
export async function unreadConversationCount(userId: string): Promise<number> {
  const rows = await prisma.conversationParticipant.findMany({
    where: { userId },
    select: { lastReadAt: true, conversation: { select: { messages: { where: { senderId: { not: userId } }, orderBy: { createdAt: "desc" }, take: 1, select: { createdAt: true } } } } },
  });
  return rows.filter((row) => {
    const last = row.conversation.messages[0]?.createdAt;
    return last !== undefined && (!row.lastReadAt || last > row.lastReadAt);
  }).length;
}

// ---------------------------------------------------------------------------
// Custom offers
// ---------------------------------------------------------------------------

export function parseOffer(value: Prisma.JsonValue | null): OfferPayload | null {
  const parsed = offerPayloadSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export async function postOffer(sellerId: string, conversationId: string, input: CustomOfferInput, now: Date): Promise<PostedMessage> {
  const offer = customOfferInputSchema.parse(input);
  const conversation = await participants(sellerId, conversationId);
  if (!conversation.pairKey?.endsWith(`:${sellerId}`)) throw new CheckoutError("Only the seller in this conversation can send offers.");
  const buyerId = conversation.pairKey.split(":")[0] ?? "";
  const listing = await prisma.listing.findFirst({
    where: { id: offer.listingId, type: "SERVICE", status: "ACTIVE", store: { sellerId } },
    select: { id: true, currency: true },
  });
  if (!listing) throw new CheckoutError("Choose one of your active services.");
  const description = screenMessage(offer.description);
  const title = screenMessage(offer.title);
  const payload: OfferPayload = {
    listingId: listing.id,
    title: title.text,
    description: description.text,
    price: offer.price,
    currency: listing.currency,
    deliveryDays: offer.deliveryDays,
    revisions: offer.revisions,
    expiresAt: new Date(now.getTime() + offer.validDays * 86_400_000).toISOString(),
    status: "OPEN",
    orderId: null,
  };
  const message = await prisma.$transaction(async (tx) => {
    const created = await tx.message.create({
      data: { conversationId, senderId: sellerId, kind: "SERVICE_OFFER", body: payload.title, offerPayload: payload, flaggedCircumvention: description.flagged || title.flagged, createdAt: now },
      select: { id: true, senderId: true, kind: true, body: true, flaggedCircumvention: true, createdAt: true },
    });
    await tx.conversation.update({ where: { id: conversationId }, data: { updatedAt: now } });
    return created;
  });
  const everyone = conversation.participants.map((participant) => participant.userId);
  await broadcast(conversationId, [], everyone, message);
  await notify({ userId: buyerId, type: "OFFER_RECEIVED", title: `New offer: ${payload.title}`, body: payload.description.slice(0, 200), href: `/messages/${conversationId}` });
  return { id: message.id, flagged: message.flaggedCircumvention };
}

async function offerMessage(userId: string, messageId: string) {
  const message = await prisma.message.findFirst({
    where: { id: messageId, kind: "SERVICE_OFFER", conversation: { participants: { some: { userId } } } },
    select: { id: true, senderId: true, conversationId: true, offerPayload: true },
  });
  const offer = message ? parseOffer(message.offerPayload) : null;
  if (!message || !offer) throw new CheckoutError("That offer does not exist.");
  return { message, offer };
}

async function saveOffer(messageId: string, offer: OfferPayload): Promise<void> {
  await prisma.message.update({ where: { id: messageId }, data: { offerPayload: offer } });
}

/** Buyer declines or seller withdraws an open offer. */
export async function closeOffer(userId: string, messageId: string, action: "decline" | "withdraw"): Promise<void> {
  const { message, offer } = await offerMessage(userId, messageId);
  if (offer.status !== "OPEN") throw new CheckoutError("This offer is no longer open.");
  if (action === "withdraw" && message.senderId !== userId) throw new CheckoutError("Only the seller can withdraw the offer.");
  if (action === "decline" && message.senderId === userId) throw new CheckoutError("Withdraw your own offer instead.");
  await saveOffer(message.id, { ...offer, status: action === "decline" ? "DECLINED" : "WITHDRAWN" });
}

/**
 * Buyer accepts: an order for the service at the offered price is created and
 * awaits payment like any checkout (escrow, milestone and workspace follow).
 */
export async function acceptOffer(buyerId: string, messageId: string, now: Date): Promise<{ orderId: string }> {
  const { message, offer } = await offerMessage(buyerId, messageId);
  if (message.senderId === buyerId) throw new CheckoutError("You cannot accept your own offer.");
  if (offer.status === "ACCEPTED" && offer.orderId) {
    const existing = await prisma.order.findUnique({ where: { id: offer.orderId }, select: { id: true, status: true } });
    if (existing && existing.status !== "CANCELLED") return { orderId: existing.id };
  } else if (offer.status !== "OPEN") {
    throw new CheckoutError("This offer is no longer open.");
  }
  if (new Date(offer.expiresAt) <= now) {
    await saveOffer(message.id, { ...offer, status: "EXPIRED" });
    throw new CheckoutError("This offer has expired. Ask the seller for a new one.");
  }

  const listing = await prisma.listing.findFirst({
    where: { id: offer.listingId, type: "SERVICE", status: "ACTIVE", store: { sellerId: message.senderId, status: "ACTIVE", vacationMode: false } },
    select: { id: true, storeId: true, store: { select: { country: true, shippingProfile: true, commissionBpsOverride: true } } },
  });
  if (!listing) throw new CheckoutError("The seller is not taking orders for this service right now.");
  const buyer = await prisma.user.findUniqueOrThrow({ where: { id: buyerId }, select: { country: true } });
  const pricing = priceCheckout({
    lines: [{ key: "offer", storeId: listing.storeId, type: "SERVICE", quantity: 1, unitPrice: offer.price, weightGrams: null }],
    stores: { [listing.storeId]: { originCountry: listing.store.country, profile: parseShippingProfile(listing.store.shippingProfile) } },
    destinationCountry: null,
    taxCountry: buyer.country,
    promo: null,
    taxRates: await getSetting("taxRates"),
  });
  const store = pricing.stores[0];
  if (!store || store.problem) throw new CheckoutError(store?.problem ?? "This offer cannot be priced.");
  const feeBps = listing.store.commissionBpsOverride ?? (await getSetting("platformFeeBps"));
  const expiresAt = new Date(now.getTime() + CHECKOUT_HOLD_MINUTES * 60_000);

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await prisma.$transaction(async (tx) => {
        const order = await tx.order.create({
          data: {
            orderNumber: orderNumber(now),
            buyerId,
            currency: offer.currency,
            itemsSubtotal: pricing.itemsSubtotal,
            shippingTotal: 0,
            taxTotal: pricing.taxTotal,
            discountTotal: 0,
            grandTotal: pricing.grandTotal,
            status: "PENDING_PAYMENT",
            expiresAt,
            metadata: { offer: { messageId: message.id } },
          },
          select: { id: true },
        });
        const subOrder = await tx.subOrder.create({
          data: {
            orderId: order.id,
            storeId: listing.storeId,
            status: "PENDING_PAYMENT",
            currency: offer.currency,
            itemsSubtotal: store.itemsSubtotal,
            shippingTotal: 0,
            taxTotal: store.tax,
            discountTotal: 0,
            grandTotal: store.total,
            platformFee: applyBps(store.itemsSubtotal, feeBps),
          },
          select: { id: true },
        });
        await tx.orderItem.create({
          data: {
            subOrderId: subOrder.id,
            listingId: listing.id,
            listingType: "SERVICE",
            titleSnapshot: offer.title,
            variantSnapshot: {
              label: "Custom offer",
              skuCode: null,
              variantValues: {},
              serviceLevel: null,
              deliveryDays: offer.deliveryDays,
              revisions: offer.revisions,
              discount: 0,
              offerMessageId: message.id,
              description: offer.description,
            },
            quantity: 1,
            unitPrice: offer.price,
            lineTotal: offer.price,
          },
        });
        await tx.message.update({ where: { id: message.id }, data: { offerPayload: { ...offer, status: "ACCEPTED", orderId: order.id } } });
        return { orderId: order.id };
      });
    } catch (error) {
      const collision = typeof error === "object" && error !== null && "code" in error && error.code === "P2002" && attempt < 2;
      if (!collision) throw error;
    }
  }
  throw new CheckoutError("We could not create the order. Try again.");
}
