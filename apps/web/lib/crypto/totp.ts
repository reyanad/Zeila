import "server-only";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Time-based one-time passwords (RFC 6238) on HMAC-SHA1 with 6 digits and a
 * 30-second step: the parameters every authenticator app supports.
 */

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const DIGITS = 6;
export const TOTP_STEP_SECONDS = 30;

export function base32Encode(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(input: string): Buffer {
  const clean = input.toUpperCase().replace(/[\s=-]/g, "");
  const out: number[] = [];
  let bits = 0;
  let value = 0;
  for (const char of clean) {
    const index = BASE32_ALPHABET.indexOf(char);
    if (index === -1) throw new Error("Invalid base32 character");
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** New 160-bit secret, base32 encoded (the size RFC 4226 recommends). */
export function generateTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

export function currentTotpStep(nowMs = Date.now()): number {
  return Math.floor(nowMs / 1000 / TOTP_STEP_SECONDS);
}

export function totpCodeForStep(secretBase32: string, step: number): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const digest = createHmac("sha1", base32Decode(secretBase32)).update(counter).digest();
  const offset = (digest[digest.length - 1] ?? 0) & 0x0f;
  const binary = digest.readUInt32BE(offset) & 0x7fffffff;
  return (binary % 10 ** DIGITS).toString().padStart(DIGITS, "0");
}

/**
 * Check a code against the current step and one step either side (clock
 * drift). Returns the matching step so callers can reject reuse, or null.
 */
export function verifyTotp(secretBase32: string, code: string, nowMs = Date.now()): number | null {
  if (!/^\d{6}$/.test(code)) return null;
  const supplied = Buffer.from(code, "utf8");
  const now = currentTotpStep(nowMs);
  let matched: number | null = null;
  for (const step of [now - 1, now, now + 1]) {
    const expected = Buffer.from(totpCodeForStep(secretBase32, step), "utf8");
    // Compare every candidate so timing does not reveal which step matched.
    if (timingSafeEqual(supplied, expected) && matched === null) matched = step;
  }
  return matched;
}

export function buildOtpauthUri(params: { secretBase32: string; accountName: string; issuer: string }): string {
  const label = encodeURIComponent(`${params.issuer}:${params.accountName}`);
  const query = new URLSearchParams({
    secret: params.secretBase32,
    issuer: params.issuer,
    algorithm: "SHA1",
    digits: String(DIGITS),
    period: String(TOTP_STEP_SECONDS),
  });
  return `otpauth://totp/${label}?${query.toString()}`;
}
