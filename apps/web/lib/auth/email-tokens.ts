import "server-only";
import { prisma } from "@marketplace/database";
import { randomToken, sha256Hex } from "@/lib/crypto/tokens";
import { passwordResetMessage, verifyEmailMessage } from "@/lib/email/templates";
import { sendEmail } from "@/lib/email/send";
import { appUrl } from "@/lib/env";

/**
 * Single-use e-mail links (verification, password reset). Only the SHA-256
 * hash of a token is stored, so a database leak cannot be turned into links.
 */

export type EmailTokenKind = "verify-email" | "password-reset";

const TTL_MS: Record<EmailTokenKind, number> = {
  "verify-email": 24 * 60 * 60 * 1000,
  "password-reset": 60 * 60 * 1000,
};

function identifier(kind: EmailTokenKind, userId: string): string {
  return `${kind}:${userId}`;
}

async function createEmailToken(kind: EmailTokenKind, userId: string): Promise<string> {
  const raw = randomToken();
  await prisma.$transaction([
    // Issuing a new link invalidates earlier ones of the same kind.
    prisma.verificationToken.deleteMany({ where: { identifier: identifier(kind, userId) } }),
    prisma.verificationToken.create({
      data: { identifier: identifier(kind, userId), token: sha256Hex(raw), expires: new Date(Date.now() + TTL_MS[kind]) },
    }),
  ]);
  return raw;
}

/** Returns the user id the token was issued for, or null if unknown/expired/used. */
export async function consumeEmailToken(kind: EmailTokenKind, raw: string): Promise<string | null> {
  if (raw.length < 20 || raw.length > 200) return null;
  const hashed = sha256Hex(raw);
  const record = await prisma.verificationToken.findUnique({ where: { token: hashed } });
  if (!record || !record.identifier.startsWith(`${kind}:`)) return null;
  const deleted = await prisma.verificationToken.deleteMany({ where: { token: hashed } });
  if (deleted.count !== 1) return null; // lost a race with another request using the same link
  if (record.expires.getTime() < Date.now()) return null;
  return record.identifier.slice(kind.length + 1);
}

export async function sendVerificationEmail(user: { id: string; email: string; name: string | null }): Promise<void> {
  const token = await createEmailToken("verify-email", user.id);
  await sendEmail(
    verifyEmailMessage({ to: user.email, name: user.name, url: appUrl(`/verify-email?token=${encodeURIComponent(token)}`) }),
  );
}

export async function sendPasswordResetEmail(user: { id: string; email: string; name: string | null }): Promise<void> {
  const token = await createEmailToken("password-reset", user.id);
  await sendEmail(
    passwordResetMessage({ to: user.email, name: user.name, url: appUrl(`/reset-password?token=${encodeURIComponent(token)}`) }),
  );
}
