import "server-only";
import { createHash } from "node:crypto";
import { confirmPayment, reconcileRefunds, refreshPayout, verifyChapaSignature } from "@marketplace/core";
import { prisma, type Prisma, type WebhookEventStatus } from "@marketplace/database";
import { getChapa } from "@/lib/chapa";
import { isUniqueViolation } from "@/lib/db-errors";
import { chapaWebhookSecret } from "@/lib/env";

/**
 * Chapa webhook receiver with an idempotent inbox.
 *
 * 1. Verify the signature (x-chapa-signature or chapa-signature).
 * 2. Store the delivery once in `WebhookEvent`. Chapa events carry no id, so
 *    the key is a hash of the body: identical redeliveries collapse into one row.
 * 3. Act on it. Handlers never trust the payload's status: they ask Chapa's
 *    verify endpoints and apply what Chapa says, so a replayed or forged event
 *    cannot mark anything paid.
 * 4. Answer 500 on failure so Chapa retries (every 10 minutes, up to 72 hours).
 */

type Handler = (payload: Record<string, unknown>) => Promise<void>;

function field(payload: Record<string, unknown>, ...names: string[]): string | null {
  for (const name of names) {
    const value = payload[name];
    if (typeof value === "string" && value.length > 0 && value.length <= 200) return value;
  }
  return null;
}

function handlerFor(type: string): Handler | null {
  const chapa = getChapa();
  if (!chapa) return null;
  if (type.startsWith("charge.")) {
    return async (payload) => {
      const txRef = field(payload, "tx_ref", "trx_ref");
      if (txRef) await confirmPayment(chapa, txRef, new Date());
    };
  }
  if (type.startsWith("payout.") || type.startsWith("transfer.")) {
    return async (payload) => {
      const reference = field(payload, "reference", "tx_ref", "merchant_reference");
      if (reference) await refreshPayout(chapa, reference, new Date());
    };
  }
  if (type.startsWith("refund.")) {
    return async () => {
      await reconcileRefunds(chapa, 50);
    };
  }
  return null;
}

interface InboxRow {
  id: string;
  status: WebhookEventStatus;
}

async function recordDelivery(eventId: string, type: string, payload: Prisma.InputJsonObject): Promise<InboxRow> {
  try {
    return await prisma.webhookEvent.create({ data: { provider: "chapa", eventId, type, payload }, select: { id: true, status: true } });
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    return prisma.webhookEvent.findUniqueOrThrow({ where: { provider_eventId: { provider: "chapa", eventId } }, select: { id: true, status: true } });
  }
}

export async function receiveChapaWebhook(request: Request): Promise<Response> {
  const secret = chapaWebhookSecret();
  if (!getChapa() || !secret) return Response.json({ error: "Chapa webhooks are not configured" }, { status: 503 });

  const rawBody = await request.text();
  if (rawBody.length > 256_000) return Response.json({ error: "Payload too large" }, { status: 413 });
  const signed = verifyChapaSignature({
    rawBody,
    chapaSignature: request.headers.get("chapa-signature"),
    xChapaSignature: request.headers.get("x-chapa-signature"),
    secret,
  });
  if (!signed) return Response.json({ error: "Invalid signature" }, { status: 400 });

  let payload: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(rawBody);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new Error("not an object");
    payload = parsed as Record<string, unknown>;
  } catch {
    return Response.json({ error: "Body is not a JSON object" }, { status: 400 });
  }

  const type = (field(payload, "event", "type") ?? "unknown").toLowerCase().slice(0, 100);
  const eventId = createHash("sha256").update(rawBody).digest("hex").slice(0, 48);
  const inbox = await recordDelivery(eventId, type, payload as Prisma.InputJsonObject);
  if (inbox.status === "PROCESSED" || inbox.status === "IGNORED") return Response.json({ received: true, duplicate: true });

  const handler = handlerFor(type);
  if (!handler) {
    await prisma.webhookEvent.update({ where: { id: inbox.id }, data: { status: "IGNORED", processedAt: new Date(), attempts: { increment: 1 } } });
    return Response.json({ received: true, ignored: true });
  }
  try {
    await handler(payload);
    await prisma.webhookEvent.update({ where: { id: inbox.id }, data: { status: "PROCESSED", processedAt: new Date(), attempts: { increment: 1 }, error: null } });
    return Response.json({ received: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[webhook] chapa ${type} failed`, error);
    await prisma.webhookEvent.update({ where: { id: inbox.id }, data: { status: "FAILED", attempts: { increment: 1 }, error: message.slice(0, 2000) } });
    return Response.json({ error: "Event processing failed" }, { status: 500 });
  }
}
