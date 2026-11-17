import "server-only";
import Redis from "ioredis";
import { getEnv } from "@/lib/env";

/**
 * Shared Redis connection (rate limiting now; BullMQ and caching in later
 * phases). Commands fail fast when Redis is down so callers can degrade
 * instead of hanging a request.
 */

const globalForRedis = globalThis as unknown as { marketplaceRedis?: Redis | null };

export function getRedis(): Redis | null {
  if (globalForRedis.marketplaceRedis !== undefined) return globalForRedis.marketplaceRedis;
  const url = getEnv().REDIS_URL;
  if (!url) {
    globalForRedis.marketplaceRedis = null;
    return null;
  }
  const client = new Redis(url, {
    lazyConnect: false,
    enableOfflineQueue: false,
    maxRetriesPerRequest: 1,
    connectTimeout: 2_000,
    retryStrategy: (attempt) => Math.min(attempt * 500, 10_000),
  });
  let lastLoggedAt = 0;
  client.on("error", (error: Error) => {
    // Reconnect attempts emit continuously while Redis is down; log sparingly.
    const now = Date.now();
    if (now - lastLoggedAt > 60_000) {
      lastLoggedAt = now;
      console.warn(`[redis] connection problem: ${error.message}`);
    }
  });
  globalForRedis.marketplaceRedis = client;
  return client;
}
