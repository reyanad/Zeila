import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";

/**
 * Encryption at rest for values the worker must read back, such as sellers'
 * payout account numbers. Same scheme and key as the web app's field
 * encryption (AES-256-GCM, key from DATA_ENCRYPTION_KEY through HKDF with
 * "marketplace:field-encryption:v1"; AUTH_SECRET in development), so either
 * process can open what the other sealed. Format: v1.<iv>.<tag>.<ciphertext>.
 */

let cachedKey: Buffer | undefined;

function fieldKey(): Buffer {
  if (cachedKey) return cachedKey;
  const dataKey = process.env.DATA_ENCRYPTION_KEY?.trim();
  let master: Buffer;
  if (dataKey) {
    master = Buffer.from(dataKey, "base64");
    if (master.length < 32) throw new Error("DATA_ENCRYPTION_KEY must be at least 32 bytes of base64 (openssl rand -base64 32).");
  } else {
    const authSecret = process.env.AUTH_SECRET?.trim();
    if (!authSecret) throw new Error("Set DATA_ENCRYPTION_KEY (or AUTH_SECRET in development) to read or store payout details.");
    master = Buffer.from(authSecret, "utf8");
  }
  cachedKey = Buffer.from(hkdfSync("sha256", master, Buffer.alloc(0), "marketplace:field-encryption:v1", 32));
  return cachedKey;
}

export function encryptAtRest(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", fieldKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), ciphertext.toString("base64url")].join(".");
}

export function decryptAtRest(stored: string): string {
  const parts = stored.split(".");
  if (parts.length !== 4 || parts[0] !== "v1") throw new Error("Unrecognised ciphertext format");
  const [, iv, tag, ciphertext] = parts as [string, string, string, string];
  const decipher = createDecipheriv("aes-256-gcm", fieldKey(), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(ciphertext, "base64url")), decipher.final()]).toString("utf8");
}
