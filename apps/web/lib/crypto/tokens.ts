import "server-only";
import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { deriveKey, type KeyPurpose } from "./keys";

/** URL-safe random token (256 bits by default). */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

export function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

const RECOVERY_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789"; // no 0/o/1/l/i

/** Human-typable recovery code: xxxxx-xxxxx (~49 bits of entropy). */
export function generateRecoveryCode(): string {
  let out = "";
  for (let index = 0; index < 10; index += 1) {
    out += RECOVERY_ALPHABET[randomInt(RECOVERY_ALPHABET.length)];
    if (index === 4) out += "-";
  }
  return out;
}

// ---------------------------------------------------------------------------
// Signed, expiring tickets: <base64url(JSON payload)>.<base64url(HMAC-SHA256)>
// ---------------------------------------------------------------------------

interface TicketEnvelope<T> {
  /** Expiry as unix seconds. */
  exp: number;
  data: T;
}

export function signTicket<T>(purpose: KeyPurpose, data: T, ttlSeconds: number): string {
  const envelope: TicketEnvelope<T> = { exp: Math.floor(Date.now() / 1000) + ttlSeconds, data };
  const body = Buffer.from(JSON.stringify(envelope), "utf8").toString("base64url");
  const signature = createHmac("sha256", deriveKey(purpose)).update(body).digest("base64url");
  return `${body}.${signature}`;
}

/** Returns the payload, or null when the ticket is malformed, forged or expired. */
export function verifyTicket<T>(purpose: KeyPurpose, ticket: string): T | null {
  if (ticket.length > 2048) return null;
  const separator = ticket.indexOf(".");
  if (separator <= 0 || separator === ticket.length - 1) return null;
  const body = ticket.slice(0, separator);
  const signature = Buffer.from(ticket.slice(separator + 1), "base64url");
  const expected = createHmac("sha256", deriveKey(purpose)).update(body).digest();
  if (signature.length !== expected.length || !timingSafeEqual(signature, expected)) return null;
  try {
    const envelope = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as TicketEnvelope<T>;
    if (typeof envelope.exp !== "number" || envelope.exp < Math.floor(Date.now() / 1000)) return null;
    return envelope.data;
  } catch {
    return null;
  }
}
