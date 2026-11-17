import "server-only";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { deriveKey } from "./keys";

/**
 * Authenticated encryption (AES-256-GCM) for data at rest: TOTP secrets,
 * government ID numbers and KYC document blobs.
 */

const IV_LENGTH = 12;
const TAG_LENGTH = 16;
const FIELD_PREFIX = "v1";

/** Encrypt a short string for storage in a text column: `v1.<iv>.<tag>.<ciphertext>`. */
export function encryptField(plaintext: string): string {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv("aes-256-gcm", deriveKey("field-encryption"), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return [FIELD_PREFIX, iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), ciphertext.toString("base64url")].join(".");
}

export function decryptField(stored: string): string {
  const parts = stored.split(".");
  if (parts.length !== 4 || parts[0] !== FIELD_PREFIX) {
    throw new Error("Unrecognised ciphertext format");
  }
  const [, iv, tag, ciphertext] = parts as [string, string, string, string];
  const decipher = createDecipheriv("aes-256-gcm", deriveKey("field-encryption"), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(ciphertext, "base64url")), decipher.final()]).toString("utf8");
}

/**
 * Encrypt a binary object. Layout: 1 version byte | 12-byte IV | 16-byte tag | ciphertext.
 * `context` (e.g. the storage key) is bound as additional authenticated data,
 * so a blob copied to another key fails to decrypt.
 */
export function encryptObject(plaintext: Uint8Array, context: string): Buffer {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv("aes-256-gcm", deriveKey("object-encryption"), iv);
  cipher.setAAD(Buffer.from(context, "utf8"));
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return Buffer.concat([Buffer.from([1]), iv, cipher.getAuthTag(), ciphertext]);
}

export function decryptObject(blob: Uint8Array, context: string): Buffer {
  const data = Buffer.from(blob.buffer, blob.byteOffset, blob.byteLength);
  if (data.length < 1 + IV_LENGTH + TAG_LENGTH || data[0] !== 1) {
    throw new Error("Unrecognised encrypted object format");
  }
  const iv = data.subarray(1, 1 + IV_LENGTH);
  const tag = data.subarray(1 + IV_LENGTH, 1 + IV_LENGTH + TAG_LENGTH);
  const ciphertext = data.subarray(1 + IV_LENGTH + TAG_LENGTH);
  const decipher = createDecipheriv("aes-256-gcm", deriveKey("object-encryption"), iv);
  decipher.setAAD(Buffer.from(context, "utf8"));
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}
