import "server-only";
import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from "node:crypto";

/**
 * Password hashing with scrypt (memory-hard, built into Node; no native addon).
 * Parameters follow the OWASP recommendation N=2^15, r=8, p=3 and are encoded
 * in the stored string so they can be raised later without a migration:
 *
 *   scrypt$<N>$<r>$<p>$<salt b64url>$<hash b64url>
 */

const CURRENT = { N: 1 << 15, r: 8, p: 3 } as const;
const KEY_LENGTH = 64;
const SALT_LENGTH = 16;

function deriveKey(password: string, salt: Buffer, params: { N: number; r: number; p: number }): Promise<Buffer> {
  const options: ScryptOptions = {
    N: params.N,
    r: params.r,
    p: params.p,
    // scrypt needs ~128 * N * r bytes; leave headroom over Node's 32 MiB default.
    maxmem: 256 * params.N * params.r,
  };
  return new Promise((resolve, reject) => {
    scrypt(password.normalize("NFKC"), salt, KEY_LENGTH, options, (error, key) => {
      if (error) reject(error);
      else resolve(key);
    });
  });
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_LENGTH);
  const key = await deriveKey(password, salt, CURRENT);
  return ["scrypt", CURRENT.N, CURRENT.r, CURRENT.p, salt.toString("base64url"), key.toString("base64url")].join("$");
}

interface ParsedHash {
  N: number;
  r: number;
  p: number;
  salt: Buffer;
  key: Buffer;
}

function parseHash(stored: string): ParsedHash | null {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return null;
  const [, n, r, p, salt, key] = parts as [string, string, string, string, string, string];
  const parsed = { N: Number(n), r: Number(r), p: Number(p) };
  if (![parsed.N, parsed.r, parsed.p].every((value) => Number.isInteger(value) && value > 0)) return null;
  // Refuse absurd cost parameters from a corrupted row instead of exhausting memory.
  if (parsed.N > 1 << 20 || parsed.r > 32 || parsed.p > 16) return null;
  return { ...parsed, salt: Buffer.from(salt, "base64url"), key: Buffer.from(key, "base64url") };
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parsed = parseHash(stored);
  if (!parsed || parsed.key.length !== KEY_LENGTH) return false;
  const candidate = await deriveKey(password, parsed.salt, parsed);
  return timingSafeEqual(candidate, parsed.key);
}

/** True when the hash was made with weaker parameters than the current ones. */
export function passwordNeedsRehash(stored: string): boolean {
  const parsed = parseHash(stored);
  if (!parsed) return true;
  return parsed.N < CURRENT.N || parsed.r < CURRENT.r || parsed.p < CURRENT.p;
}

let dummyHash: Promise<string> | undefined;

/**
 * Burn the same CPU time as a real verification when the account does not
 * exist, so response timing does not reveal which e-mails are registered.
 */
export async function verifyPasswordAgainstDummy(password: string): Promise<void> {
  dummyHash ??= hashPassword(randomBytes(18).toString("base64url"));
  await verifyPassword(password, await dummyHash);
}
