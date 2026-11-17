"use server";

import { prisma } from "@marketplace/database";
import {
  changePasswordSchema,
  fieldErrors,
  forgotPasswordSchema,
  loginSchema,
  registerSchema,
  resetPasswordSchema,
} from "@marketplace/shared-types";
import { recordAudit } from "@/lib/audit";
import { consumeEmailToken, sendPasswordResetEmail, sendVerificationEmail } from "@/lib/auth/email-tokens";
import { beginPasswordLogin } from "@/lib/auth/login";
import { authorize } from "@/lib/auth/session";
import { hashPassword, verifyPassword } from "@/lib/crypto/password";
import { sha256Hex } from "@/lib/crypto/tokens";
import { sendEmail } from "@/lib/email/send";
import { existingAccountMessage, securityNoticeMessage } from "@/lib/email/templates";
import { appUrl } from "@/lib/env";
import { formError, formSuccess, type FormState } from "@/lib/form-state";
import { describeRetry, rateLimit } from "@/lib/rate-limit";
import { getClientIp } from "@/lib/request";

const GENERIC_FAILURE = "Something went wrong on our side. Please try again.";

/** At most three e-mails of one kind per address per hour, however they are requested. */
async function mayEmail(kind: string, email: string): Promise<boolean> {
  return (await rateLimit(`mail:${kind}:${sha256Hex(email)}`, 3, 60 * 60)).allowed;
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

export async function registerAction(_previous: FormState, formData: FormData): Promise<FormState> {
  const parsed = registerSchema.safeParse({
    name: formData.get("name"),
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) return formError("Check the highlighted fields.", fieldErrors(parsed.error));
  const { name, email, password } = parsed.data;

  const ip = await getClientIp();
  const limit = await rateLimit(`register:${ip}`, 10, 60 * 60);
  if (!limit.allowed) return formError(`Too many sign-up attempts. ${describeRetry(limit.retryAfterSeconds)}`);

  try {
    // Hash before looking the address up so timing is the same either way.
    const hashedPassword = await hashPassword(password);
    const existing = await prisma.user.findUnique({ where: { email } });

    if (!existing) {
      const user = await prisma.user.create({ data: { email, name, hashedPassword } });
      await sendVerificationEmail(user);
      await recordAudit({ actorId: user.id, action: "auth.register", entity: "User", entityId: user.id, ipAddress: ip });
    } else if (await mayEmail("register", email)) {
      if (existing.emailVerified) {
        await sendEmail(existingAccountMessage({ to: existing.email, loginUrl: appUrl("/login") }));
      } else {
        // Unconfirmed sign-up: resend the link but keep the original
        // credentials, so a second registrant cannot swap in their password.
        await sendVerificationEmail(existing);
      }
    }
  } catch (error) {
    console.error("[auth] registration failed", error);
    return formError(GENERIC_FAILURE);
  }

  // Same answer whether or not the address was already registered.
  return formSuccess(`We sent a confirmation link to ${email}. Open it to activate your account, then sign in.`);
}

// ---------------------------------------------------------------------------
// Sign-in, step 1 (password). Step 2 is `signIn("credentials", { ticket, code })`.
// ---------------------------------------------------------------------------

export type LoginActionResult =
  | { status: "ok"; ticket: string; twoFactorRequired: boolean }
  | { status: "error"; message: string; fields?: Record<string, string> };

export async function beginLoginAction(input: { email: string; password: string }): Promise<LoginActionResult> {
  const parsed = loginSchema.safeParse(input);
  if (!parsed.success) {
    return { status: "error", message: "Check the highlighted fields.", fields: fieldErrors(parsed.error) };
  }
  const { email, password } = parsed.data;

  try {
    const result = await beginPasswordLogin(email, password, await getClientIp());
    switch (result.status) {
      case "ok":
        return result;
      case "invalid":
        return { status: "error", message: "Incorrect email or password." };
      case "suspended":
        return { status: "error", message: "This account has been suspended. Contact support for help." };
      case "rate_limited":
        return { status: "error", message: `Too many sign-in attempts. ${describeRetry(result.retryAfterSeconds)}` };
      case "unverified": {
        if (await mayEmail("verify", email)) {
          const user = await prisma.user.findUnique({ where: { id: result.userId }, select: { id: true, email: true, name: true } });
          if (user) await sendVerificationEmail(user);
        }
        return {
          status: "error",
          message: "Confirm your email address before signing in. We have sent you a new confirmation link.",
        };
      }
    }
  } catch (error) {
    console.error("[auth] sign-in failed", error);
    return { status: "error", message: GENERIC_FAILURE };
  }
}

// ---------------------------------------------------------------------------
// Password reset
// ---------------------------------------------------------------------------

export async function requestPasswordResetAction(_previous: FormState, formData: FormData): Promise<FormState> {
  const parsed = forgotPasswordSchema.safeParse({ email: formData.get("email") });
  if (!parsed.success) return formError("Enter a valid email address.", fieldErrors(parsed.error));
  const { email } = parsed.data;

  const ip = await getClientIp();
  const limit = await rateLimit(`forgot:${ip}`, 10, 60 * 60);
  if (!limit.allowed) return formError(`Too many requests. ${describeRetry(limit.retryAfterSeconds)}`);

  try {
    const user = await prisma.user.findUnique({ where: { email }, select: { id: true, email: true, name: true, isSuspended: true } });
    if (user && !user.isSuspended && (await mayEmail("reset", email))) {
      await sendPasswordResetEmail(user);
      await recordAudit({ actorId: user.id, action: "auth.password.reset-requested", entity: "User", entityId: user.id, ipAddress: ip });
    }
  } catch (error) {
    console.error("[auth] password reset request failed", error);
    return formError(GENERIC_FAILURE);
  }
  return formSuccess(`If an account exists for ${email}, a reset link is on its way. It expires in one hour.`);
}

export async function resetPasswordAction(_previous: FormState, formData: FormData): Promise<FormState> {
  const parsed = resetPasswordSchema.safeParse({ token: formData.get("token"), password: formData.get("password") });
  if (!parsed.success) {
    const fields = fieldErrors(parsed.error);
    return formError(fields.token ? "This reset link is not valid. Request a new one." : "Check the highlighted fields.", fields);
  }
  if (formData.get("confirmPassword") !== parsed.data.password) {
    return formError("Check the highlighted fields.", { confirmPassword: "The passwords do not match" });
  }

  const ip = await getClientIp();
  const limit = await rateLimit(`reset:${ip}`, 10, 60 * 60);
  if (!limit.allowed) return formError(`Too many attempts. ${describeRetry(limit.retryAfterSeconds)}`);

  try {
    const userId = await consumeEmailToken("password-reset", parsed.data.token);
    if (!userId) return formError("This reset link has expired or was already used. Request a new one.");

    const hashedPassword = await hashPassword(parsed.data.password);
    const user = await prisma.user.update({
      where: { id: userId },
      data: {
        hashedPassword,
        // Using the link proves control of the mailbox.
        emailVerified: new Date(),
        // Sign out every existing session.
        sessionVersion: { increment: 1 },
      },
      select: { id: true, email: true, name: true },
    });
    await recordAudit({ actorId: user.id, action: "auth.password.reset", entity: "User", entityId: user.id, ipAddress: ip });
    await sendEmail(
      securityNoticeMessage({ to: user.email, name: user.name, event: "The password for your account was reset using an email link." }),
    );
  } catch (error) {
    console.error("[auth] password reset failed", error);
    return formError(GENERIC_FAILURE);
  }
  return formSuccess("Your password has been changed. You can now sign in with it.");
}

// ---------------------------------------------------------------------------
// Signed-in account security
// ---------------------------------------------------------------------------

export async function changePasswordAction(_previous: FormState, formData: FormData): Promise<FormState> {
  const auth = await authorize();
  if (!auth.ok) return formError(auth.message);

  const parsed = changePasswordSchema.safeParse({
    currentPassword: formData.get("currentPassword") ?? "",
    newPassword: formData.get("newPassword"),
  });
  if (!parsed.success) return formError("Check the highlighted fields.", fieldErrors(parsed.error));
  if (formData.get("confirmPassword") !== parsed.data.newPassword) {
    return formError("Check the highlighted fields.", { confirmPassword: "The passwords do not match" });
  }

  const limit = await rateLimit(`change-password:${auth.user.id}`, 5, 15 * 60);
  if (!limit.allowed) return formError(`Too many attempts. ${describeRetry(limit.retryAfterSeconds)}`);

  try {
    const user = await prisma.user.findUnique({ where: { id: auth.user.id }, select: { id: true, email: true, name: true, hashedPassword: true } });
    if (!user) return formError("Your session has expired. Sign in again.");

    // Accounts created through Google/GitHub have no password yet and may set one.
    if (user.hashedPassword) {
      const matches = await verifyPassword(parsed.data.currentPassword, user.hashedPassword);
      if (!matches) return formError("Check the highlighted fields.", { currentPassword: "That is not your current password" });
    }

    await prisma.user.update({
      where: { id: user.id },
      data: { hashedPassword: await hashPassword(parsed.data.newPassword), sessionVersion: { increment: 1 } },
    });
    await recordAudit({ actorId: user.id, action: "auth.password.change", entity: "User", entityId: user.id, ipAddress: await getClientIp() });
    await sendEmail(securityNoticeMessage({ to: user.email, name: user.name, event: "The password for your account was changed." }));
  } catch (error) {
    console.error("[auth] password change failed", error);
    return formError(GENERIC_FAILURE);
  }
  return formSuccess("Password updated. For your security you have been signed out everywhere; sign in again to continue.");
}

/** Revoke every session for the current user, including this one. */
export async function signOutEverywhereAction(): Promise<FormState> {
  const auth = await authorize();
  if (!auth.ok) return formError(auth.message);
  try {
    await prisma.user.update({ where: { id: auth.user.id }, data: { sessionVersion: { increment: 1 } } });
    await recordAudit({ actorId: auth.user.id, action: "auth.sessions.revoke", entity: "User", entityId: auth.user.id, ipAddress: await getClientIp() });
  } catch (error) {
    console.error("[auth] revoking sessions failed", error);
    return formError(GENERIC_FAILURE);
  }
  return formSuccess("All sessions have been signed out.");
}
