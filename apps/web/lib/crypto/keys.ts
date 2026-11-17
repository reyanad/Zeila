import "server-only";
import { hkdfSync } from "node:crypto";
import { getEnv } from "@/lib/env";

/**
 * Key derivation. Every purpose gets its own 256-bit key so a signature made
 * for one feature can never be replayed against another.
 *
 * - Signing keys derive from AUTH_SECRET (rotating it invalidates sessions and
 *   outstanding links, which is the desired effect).
 * - Data-at-rest keys derive from DATA_ENCRYPTION_KEY so rotating the session
 *   secret does not make stored ciphertext unreadable. In development the key
 *   falls back to AUTH_SECRET so the app runs with a single secret.
 */

export type KeyPurpose =
  | "login-ticket"
  | "upload-ticket"
  | "download-ticket"
  | "field-encryption"
  | "object-encryption";

const cache = new Map<KeyPurpose, Buffer>();

function masterSecret(purpose: KeyPurpose): Buffer {
  const env = getEnv();
  if (purpose === "login-ticket" || purpose === "upload-ticket" || purpose === "download-ticket") {
    return Buffer.from(env.AUTH_SECRET, "utf8");
  }
  if (env.DATA_ENCRYPTION_KEY) {
    const key = Buffer.from(env.DATA_ENCRYPTION_KEY, "base64");
    if (key.length < 32) {
      throw new Error("DATA_ENCRYPTION_KEY must be at least 32 bytes of base64 (openssl rand -base64 32).");
    }
    return key;
  }
  return Buffer.from(env.AUTH_SECRET, "utf8");
}

export function deriveKey(purpose: KeyPurpose): Buffer {
  const existing = cache.get(purpose);
  if (existing) return existing;
  const derived = Buffer.from(hkdfSync("sha256", masterSecret(purpose), Buffer.alloc(0), `marketplace:${purpose}:v1`, 32));
  cache.set(purpose, derived);
  return derived;
}
