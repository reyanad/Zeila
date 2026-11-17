import "server-only";
import { prisma, type User } from "@marketplace/database";
import { secondFactorCodeSchema } from "@marketplace/shared-types";
import { decryptField } from "@/lib/crypto/encryption";
import { hashPassword, passwordNeedsRehash, verifyPassword, verifyPasswordAgainstDummy } from "@/lib/crypto/password";
import { sha256Hex, signTicket, verifyTicket } from "@/lib/crypto/tokens";
import { verifyTotp, TOTP_STEP_SECONDS } from "@/lib/crypto/totp";
import { claimOnce, rateLimit } from "@/lib/rate-limit";
import { recordAudit } from "@/lib/audit";

/**
 * Two-step sign-in.
 *
 * Step 1 proves the first factor (password here, or an OAuth provider in the
 * signIn callback) and issues a short-lived signed *login ticket*.
 * Step 2 (`completeTicketLogin`, called from the Credentials provider)
 * exchanges the ticket, plus a TOTP or recovery code when two-factor is on,
 * for a session. The password itself never reaches Auth.js.
 */

const TICKET_TTL_SECONDS = 5 * 60;

export interface LoginTicket {
  uid: string;
  /** User.sessionVersion when the ticket was issued. */
  sv: number;
  method: "password" | "oauth";
}

export function issueLoginTicket(user: Pick<User, "id" | "sessionVersion">, method: LoginTicket["method"]): string {
  return signTicket<LoginTicket>("login-ticket", { uid: user.id, sv: user.sessionVersion, method }, TICKET_TTL_SECONDS);
}

export type PasswordLoginResult =
  | { status: "ok"; ticket: string; twoFactorRequired: boolean }
  | { status: "invalid" }
  | { status: "unverified"; userId: string }
  | { status: "suspended" }
  | { status: "rate_limited"; retryAfterSeconds: number };

export async function beginPasswordLogin(email: string, password: string, ip: string): Promise<PasswordLoginResult> {
  // Two buckets: per address+IP stops guessing one account, per IP stops spraying many.
  const [perAccount, perIp] = await Promise.all([
    rateLimit(`login:${sha256Hex(email)}:${ip}`, 8, 15 * 60),
    rateLimit(`login-ip:${ip}`, 40, 15 * 60),
  ]);
  if (!perAccount.allowed || !perIp.allowed) {
    return { status: "rate_limited", retryAfterSeconds: Math.max(perAccount.retryAfterSeconds, perIp.retryAfterSeconds) };
  }

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || !user.hashedPassword) {
    await verifyPasswordAgainstDummy(password);
    return { status: "invalid" };
  }
  if (!(await verifyPassword(password, user.hashedPassword))) {
    await recordAudit({ actorId: user.id, action: "auth.login.failed", entity: "User", entityId: user.id, ipAddress: ip });
    return { status: "invalid" };
  }
  if (user.isSuspended) return { status: "suspended" };
  if (!user.emailVerified) return { status: "unverified", userId: user.id };

  if (passwordNeedsRehash(user.hashedPassword)) {
    await prisma.user.update({ where: { id: user.id }, data: { hashedPassword: await hashPassword(password) } });
  }
  return { status: "ok", ticket: issueLoginTicket(user, "password"), twoFactorRequired: user.twoFactorEnabled };
}

export type TicketLoginFailure = "ticket_expired" | "code_required" | "invalid_code" | "rate_limited" | "suspended";

export class TicketLoginError extends Error {
  constructor(public readonly reason: TicketLoginFailure) {
    super(reason);
    this.name = "TicketLoginError";
  }
}

export interface AuthenticatedUser {
  id: string;
  email: string;
  name: string | null;
  image: string | null;
}

/** Verify a TOTP or recovery code for a user with two-factor enabled. */
export async function verifySecondFactor(user: Pick<User, "id" | "twoFactorSecret">, rawCode: string): Promise<boolean> {
  const parsed = secondFactorCodeSchema.safeParse(rawCode);
  if (!parsed.success || !user.twoFactorSecret) return false;
  const code = parsed.data;

  if (/^\d{6}$/.test(code)) {
    const step = verifyTotp(decryptField(user.twoFactorSecret), code);
    if (step === null) return false;
    // A code is valid for up to three steps; refuse to accept the same one twice.
    return claimOnce(`totp:${user.id}:${step}`, TOTP_STEP_SECONDS * 4);
  }

  const consumed = await prisma.twoFactorRecoveryCode.updateMany({
    where: { userId: user.id, codeHash: sha256Hex(code), usedAt: null },
    data: { usedAt: new Date() },
  });
  return consumed.count === 1;
}

export async function completeTicketLogin(ticket: string, code: string | undefined, ip: string): Promise<AuthenticatedUser> {
  const payload = verifyTicket<LoginTicket>("login-ticket", ticket);
  if (!payload) throw new TicketLoginError("ticket_expired");

  const user = await prisma.user.findUnique({ where: { id: payload.uid } });
  if (!user || user.sessionVersion !== payload.sv) throw new TicketLoginError("ticket_expired");
  if (user.isSuspended) throw new TicketLoginError("suspended");

  if (user.twoFactorEnabled) {
    if (!code) throw new TicketLoginError("code_required");
    const attempts = await rateLimit(`2fa:${user.id}`, 6, 10 * 60);
    if (!attempts.allowed) throw new TicketLoginError("rate_limited");
    if (!(await verifySecondFactor(user, code))) {
      await recordAudit({ actorId: user.id, action: "auth.2fa.failed", entity: "User", entityId: user.id, ipAddress: ip });
      throw new TicketLoginError("invalid_code");
    }
  }

  return { id: user.id, email: user.email, name: user.name, image: user.image };
}
