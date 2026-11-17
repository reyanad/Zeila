"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { acceptOffer, CheckoutError, closeOffer, markConversationRead, openConversation, postMessage, postOffer } from "@marketplace/core";
import { customOfferInputSchema, parseMoneyInput } from "@marketplace/shared-types";
import { getCurrentUser } from "@/lib/auth/session";
import { describeRetry, rateLimit } from "@/lib/rate-limit";

export type MessagingResult<T = undefined> = { ok: true; data?: T; message?: string } | { ok: false; message: string };

async function run<T>(work: () => Promise<T>): Promise<MessagingResult<T>> {
  try {
    return { ok: true, data: await work() };
  } catch (error) {
    if (error instanceof CheckoutError) return { ok: false, message: error.message };
    throw error;
  }
}

/** "Contact seller": open (or reuse) the thread with a store and go to it. */
export async function contactSellerAction(storeId: string, listingId: string | null, returnTo: string, orderId: string | null = null): Promise<MessagingResult> {
  const user = await getCurrentUser();
  if (!user) redirect(`/login?callbackUrl=${encodeURIComponent(returnTo.startsWith("/") ? returnTo : "/")}`);
  const result = await run(() => openConversation(user.id, storeId, { listingId, orderId }));
  if (!result.ok) return result;
  redirect(`/messages/${result.data}`);
}

export async function sendMessageAction(conversationId: string, body: string): Promise<MessagingResult<{ flagged: boolean }>> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, message: "Your session has expired." };
  const limit = await rateLimit(`message:${user.id}`, 30, 60);
  if (!limit.allowed) return { ok: false, message: `You are sending messages too quickly. ${describeRetry(limit.retryAfterSeconds)}` };
  const result = await run(() => postMessage(user.id, conversationId, body, new Date()));
  if (result.ok) revalidatePath(`/messages/${conversationId}`);
  return result.ok ? { ok: true, data: { flagged: result.data?.flagged ?? false } } : result;
}

export async function markReadAction(conversationId: string): Promise<void> {
  const user = await getCurrentUser();
  if (!user) return;
  try {
    await markConversationRead(user.id, conversationId, new Date());
  } catch (error) {
    if (!(error instanceof CheckoutError)) throw error;
  }
}

export interface OfferFormValues {
  listingId: string;
  title: string;
  description: string;
  price: string;
  deliveryDays: string;
  revisions: string;
  validDays: string;
}

export async function sendOfferAction(conversationId: string, values: OfferFormValues): Promise<MessagingResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, message: "Your session has expired." };
  const price = parseMoneyInput(values.price);
  if (price === null) return { ok: false, message: "Enter the price, like 2500 or 49.99." };
  const parsed = customOfferInputSchema.safeParse({
    listingId: values.listingId,
    title: values.title,
    description: values.description,
    price,
    deliveryDays: Number.parseInt(values.deliveryDays, 10),
    revisions: Number.parseInt(values.revisions, 10),
    validDays: Number.parseInt(values.validDays, 10),
  });
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Check the offer details." };
  const result = await run(() => postOffer(user.id, conversationId, parsed.data, new Date()));
  if (result.ok) revalidatePath(`/messages/${conversationId}`);
  return result.ok ? { ok: true, message: "Offer sent." } : result;
}

export async function acceptOfferAction(messageId: string): Promise<MessagingResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, message: "Your session has expired." };
  const result = await run(() => acceptOffer(user.id, messageId, new Date()));
  if (!result.ok) return result;
  redirect(`/checkout/pay/${result.data?.orderId ?? ""}`);
}

export async function closeOfferAction(conversationId: string, messageId: string, action: "decline" | "withdraw"): Promise<MessagingResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, message: "Your session has expired." };
  const result = await run(() => closeOffer(user.id, messageId, action));
  if (result.ok) revalidatePath(`/messages/${conversationId}`);
  return result.ok ? { ok: true } : result;
}
