import "server-only";
import { getRedis } from "@/lib/redis";

/**
 * Fixed-window rate limiter. Redis keeps the counters so limits hold across
 * instances; if Redis is unreachable the limiter falls back to per-process
 * memory rather than failing open.
 */

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

interface MemoryWindow {
  count: number;
  resetAt: number;
}

const memoryWindows = new Map<string, MemoryWindow>();
const MEMORY_MAX_KEYS = 50_000;

function hitMemory(key: string, windowSeconds: number): { count: number; ttlSeconds: number } {
  const now = Date.now();
  if (memoryWindows.size > MEMORY_MAX_KEYS) {
    for (const [storedKey, window] of memoryWindows) {
      if (window.resetAt <= now) memoryWindows.delete(storedKey);
    }
  }
  const existing = memoryWindows.get(key);
  if (!existing || existing.resetAt <= now) {
    memoryWindows.set(key, { count: 1, resetAt: now + windowSeconds * 1000 });
    return { count: 1, ttlSeconds: windowSeconds };
  }
  existing.count += 1;
  return { count: existing.count, ttlSeconds: Math.max(1, Math.ceil((existing.resetAt - now) / 1000)) };
}

async function hitRedis(key: string, windowSeconds: number): Promise<{ count: number; ttlSeconds: number } | null> {
  const redis = getRedis();
  if (!redis || redis.status !== "ready") return null;
  try {
    const results = await redis.multi().incr(key).expire(key, windowSeconds, "NX").ttl(key).exec();
    if (!results) return null;
    const count = Number(results[0]?.[1]);
    const ttl = Number(results[2]?.[1]);
    if (!Number.isFinite(count)) return null;
    return { count, ttlSeconds: ttl > 0 ? ttl : windowSeconds };
  } catch {
    return null;
  }
}

export async function rateLimit(key: string, limit: number, windowSeconds: number): Promise<RateLimitResult> {
  const namespaced = `rl:${key}`;
  const hit = (await hitRedis(namespaced, windowSeconds)) ?? hitMemory(namespaced, windowSeconds);
  const allowed = hit.count <= limit;
  return {
    allowed,
    remaining: Math.max(0, limit - hit.count),
    retryAfterSeconds: allowed ? 0 : hit.ttlSeconds,
  };
}

/**
 * Claim a key exactly once within `ttlSeconds` (used to reject replayed TOTP
 * codes). Returns false when the key was already claimed.
 */
export async function claimOnce(key: string, ttlSeconds: number): Promise<boolean> {
  const result = await rateLimit(`once:${key}`, 1, ttlSeconds);
  return result.allowed;
}

export function describeRetry(retryAfterSeconds: number): string {
  if (retryAfterSeconds <= 60) return "Try again in a minute.";
  return `Try again in ${Math.ceil(retryAfterSeconds / 60)} minutes.`;
}
