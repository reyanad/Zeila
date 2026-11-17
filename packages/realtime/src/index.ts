import { createHmac, hkdfSync, timingSafeEqual } from "node:crypto";
import { Redis } from "ioredis";

/**
 * Real-time fan-out. Any server process publishes events for users to Redis
 * (`rt:user:<id>`); every realtime server instance subscribes to the pattern
 * and forwards the event to that user's open sockets. Publishing never
 * throws: real-time delivery is best-effort, the database is the record.
 */

export const USER_CHANNEL_PREFIX = "rt:user:";

export interface MessageEventPayload {
  id: string;
  conversationId: string;
  senderId: string;
  kind: string;
  body: string | null;
  flagged: boolean;
  createdAt: string;
}

export type RealtimeEvent =
  | { type: "message"; conversationId: string; message: MessageEventPayload }
  | { type: "typing"; conversationId: string; userId: string; name: string | null }
  | { type: "read"; conversationId: string; userId: string; at: string }
  | { type: "notification"; id: string; title: string; body: string | null; href: string | null; unread: number };

export function isRealtimeEvent(value: unknown): value is RealtimeEvent {
  if (typeof value !== "object" || value === null) return false;
  const type = (value as { type?: unknown }).type;
  return type === "message" || type === "typing" || type === "read" || type === "notification";
}

let publisher: Redis | null = null;

function getPublisher(): Redis | null {
  const url = process.env.REDIS_URL;
  if (!url) return null;
  if (!publisher) {
    publisher = new Redis(url, { maxRetriesPerRequest: 1, enableOfflineQueue: false, connectTimeout: 2_000, lazyConnect: false });
    publisher.on("error", (error: Error) => console.error(`[realtime] Redis error: ${error.message}`));
  }
  return publisher;
}

export async function publishToUsers(userIds: readonly string[], event: RealtimeEvent): Promise<void> {
  const redis = getPublisher();
  if (!redis || userIds.length === 0) return;
  const payload = JSON.stringify(event);
  try {
    const pipeline = redis.pipeline();
    for (const userId of new Set(userIds)) pipeline.publish(`${USER_CHANNEL_PREFIX}${userId}`, payload);
    await pipeline.exec();
  } catch (error) {
    console.error("[realtime] publish failed", error);
  }
}

// ---------------------------------------------------------------------------
// Connection tickets: the web app signs a short-lived ticket for the signed-in
// user; the realtime server verifies it with the same AUTH_SECRET.
// ---------------------------------------------------------------------------

function ticketKey(secret: string): Buffer {
  return Buffer.from(hkdfSync("sha256", Buffer.from(secret, "utf8"), Buffer.alloc(0), "marketplace:realtime-ticket:v1", 32));
}

export function signRealtimeTicket(secret: string, userId: string, ttlSeconds = 60, now = Date.now()): string {
  const body = Buffer.from(JSON.stringify({ sub: userId, exp: Math.floor(now / 1000) + ttlSeconds }), "utf8").toString("base64url");
  const signature = createHmac("sha256", ticketKey(secret)).update(body).digest("base64url");
  return `${body}.${signature}`;
}

export function verifyRealtimeTicket(secret: string, ticket: string, now = Date.now()): string | null {
  const [body, signature, extra] = ticket.split(".");
  if (!body || !signature || extra !== undefined) return null;
  const expected = createHmac("sha256", ticketKey(secret)).update(body).digest();
  const given = Buffer.from(signature, "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as { sub?: unknown; exp?: unknown };
    if (typeof parsed.sub !== "string" || typeof parsed.exp !== "number" || parsed.exp < Math.floor(now / 1000)) return null;
    return parsed.sub;
  } catch {
    return null;
  }
}
