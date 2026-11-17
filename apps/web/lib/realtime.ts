import "server-only";
import { signRealtimeTicket } from "@marketplace/realtime";
import { getEnv } from "@/lib/env";

/** Public URL of the Socket.io gateway (apps/realtime), or null to fall back to polling. */
export function realtimeUrl(): string | null {
  const raw = process.env.NEXT_PUBLIC_REALTIME_URL?.trim();
  if (!raw) return null;
  try {
    return new URL(raw).origin;
  } catch {
    return null;
  }
}

export function realtimeTicket(userId: string): string {
  return signRealtimeTicket(getEnv().AUTH_SECRET, userId, 60);
}
