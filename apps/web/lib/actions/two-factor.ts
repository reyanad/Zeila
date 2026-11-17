"use server";

import QRCode from "qrcode";
import { prisma } from "@marketplace/database";
import { totpCodeSchema } from "@marketplace/shared-types";
import { recordAudit } from "@/lib/audit";
import { verifySecondFactor } from "@/lib/auth/login";
import { authorize } from "@/lib/auth/session";
import { decryptField, encryptField } from "@/lib/crypto/encryption";
import { generateRecoveryCode, sha256Hex } from "@/lib/crypto/tokens";
import { buildOtpauthUri, generateTotpSecret, verifyTotp } from "@/lib/crypto/totp";
import { sendEmail } from "@/lib/email/send";
import { securityNoticeMessage } from "@/lib/email/templates";
import { describeRetry, rateLimit } from "@/lib/rate-limit";
import { getClientIp } from "@/lib/request";

const ISSUER = "Marketplace";
const RECOVERY_CODE_COUNT = 10;

export interface TwoFactorState {
  status: "idle" | "success" | "error";
  message?: string;
  /** Shown exactly once, right after enabling or regenerating. */
  recoveryCodes?: string[];
}

export type TwoFactorSetupResult =
  | { ok: true; secret: string; otpauthUri: string; qrDataUrl: string }
  | { ok: false; message: string };

function failure(message: string): TwoFactorState {
  return { status: "error", message };
}

async function manageLimit(userId: string): Promise<string | null> {
  const limit = await rateLimit(`2fa-manage:${userId}`, 10, 10 * 60);
  return limit.allowed ? null : `Too many attempts. ${describeRetry(limit.retryAfterSeconds)}`;
}

async function replaceRecoveryCodes(userId: string): Promise<string[]> {
  const codes = Array.from({ length: RECOVERY_CODE_COUNT }, () => generateRecoveryCode());
  await prisma.$transaction([
    prisma.twoFactorRecoveryCode.deleteMany({ where: { userId } }),
    prisma.twoFactorRecoveryCode.createMany({ data: codes.map((code) => ({ userId, codeHash: sha256Hex(code) })) }),
  ]);
  return codes;
}

/** Step 1: create a pending secret and return it for the authenticator app. */
export async function beginTwoFactorSetupAction(): Promise<TwoFactorSetupResult> {
  const auth = await authorize();
  if (!auth.ok) return { ok: false, message: auth.message };
  if (auth.user.twoFactorEnabled) return { ok: false, message: "Two-factor authentication is already on." };
  const limited = await manageLimit(auth.user.id);
  if (limited) return { ok: false, message: limited };

  try {
    const secret = generateTotpSecret();
    // Stored encrypted and inactive until a code from the app confirms it.
    await prisma.user.update({ where: { id: auth.user.id }, data: { twoFactorSecret: encryptField(secret) } });
    const otpauthUri = buildOtpauthUri({ secretBase32: secret, accountName: auth.user.email, issuer: ISSUER });
    const qrDataUrl = await QRCode.toDataURL(otpauthUri, { margin: 1, width: 220, errorCorrectionLevel: "M" });
    return { ok: true, secret, otpauthUri, qrDataUrl };
  } catch (error) {
    console.error("[2fa] setup failed", error);
    return { ok: false, message: "Could not start two-factor setup. Please try again." };
  }
}

/** Step 2: prove the app is set up, then switch two-factor on. */
export async function confirmTwoFactorSetupAction(_previous: TwoFactorState, formData: FormData): Promise<TwoFactorState> {
  const auth = await authorize();
  if (!auth.ok) return failure(auth.message);
  if (auth.user.twoFactorEnabled) return failure("Two-factor authentication is already on.");
  const parsed = totpCodeSchema.safeParse(formData.get("code") ?? "");
  if (!parsed.success) return failure("Enter the 6-digit code from your authenticator app.");
  const limited = await manageLimit(auth.user.id);
  if (limited) return failure(limited);

  try {
    const user = await prisma.user.findUnique({ where: { id: auth.user.id }, select: { id: true, email: true, name: true, twoFactorSecret: true } });
    if (!user?.twoFactorSecret) return failure("Start the setup again to get a new QR code.");
    if (verifyTotp(decryptField(user.twoFactorSecret), parsed.data) === null) {
      return failure("That code is not correct. Check the time on your phone and try the next code.");
    }

    await prisma.user.update({ where: { id: user.id }, data: { twoFactorEnabled: true } });
    const recoveryCodes = await replaceRecoveryCodes(user.id);
    await recordAudit({ actorId: user.id, action: "auth.2fa.enable", entity: "User", entityId: user.id, ipAddress: await getClientIp() });
    await sendEmail(securityNoticeMessage({ to: user.email, name: user.name, event: "Two-factor authentication was turned on for your account." }));
    return { status: "success", message: "Two-factor authentication is on.", recoveryCodes };
  } catch (error) {
    console.error("[2fa] confirmation failed", error);
    return failure("Could not turn on two-factor authentication. Please try again.");
  }
}

/** Requires a current code (or recovery code), so a hijacked session alone cannot switch it off. */
export async function disableTwoFactorAction(_previous: TwoFactorState, formData: FormData): Promise<TwoFactorState> {
  const auth = await authorize();
  if (!auth.ok) return failure(auth.message);
  if (!auth.user.twoFactorEnabled) return failure("Two-factor authentication is already off.");
  const limited = await manageLimit(auth.user.id);
  if (limited) return failure(limited);

  try {
    const user = await prisma.user.findUnique({ where: { id: auth.user.id }, select: { id: true, email: true, name: true, twoFactorSecret: true } });
    if (!user || !(await verifySecondFactor(user, String(formData.get("code") ?? "")))) {
      return failure("That code is not correct.");
    }
    await prisma.$transaction([
      prisma.user.update({ where: { id: user.id }, data: { twoFactorEnabled: false, twoFactorSecret: null } }),
      prisma.twoFactorRecoveryCode.deleteMany({ where: { userId: user.id } }),
    ]);
    await recordAudit({ actorId: user.id, action: "auth.2fa.disable", entity: "User", entityId: user.id, ipAddress: await getClientIp() });
    await sendEmail(securityNoticeMessage({ to: user.email, name: user.name, event: "Two-factor authentication was turned off for your account." }));
    return { status: "success", message: "Two-factor authentication is off." };
  } catch (error) {
    console.error("[2fa] disable failed", error);
    return failure("Could not turn off two-factor authentication. Please try again.");
  }
}

export async function regenerateRecoveryCodesAction(_previous: TwoFactorState, formData: FormData): Promise<TwoFactorState> {
  const auth = await authorize();
  if (!auth.ok) return failure(auth.message);
  if (!auth.user.twoFactorEnabled) return failure("Turn on two-factor authentication first.");
  const limited = await manageLimit(auth.user.id);
  if (limited) return failure(limited);

  try {
    const user = await prisma.user.findUnique({ where: { id: auth.user.id }, select: { id: true, twoFactorSecret: true } });
    if (!user || !(await verifySecondFactor(user, String(formData.get("code") ?? "")))) {
      return failure("That code is not correct.");
    }
    const recoveryCodes = await replaceRecoveryCodes(user.id);
    await recordAudit({ actorId: user.id, action: "auth.2fa.recovery-regenerate", entity: "User", entityId: user.id, ipAddress: await getClientIp() });
    return { status: "success", message: "New recovery codes created. The old ones no longer work.", recoveryCodes };
  } catch (error) {
    console.error("[2fa] recovery code regeneration failed", error);
    return failure("Could not create new recovery codes. Please try again.");
  }
}
