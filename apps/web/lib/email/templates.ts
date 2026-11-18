import "server-only";
import { APP_NAME } from "@marketplace/shared-types";
import type { EmailMessage } from "./send";

const BRAND = APP_NAME;

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

interface LayoutParams {
  heading: string;
  paragraphs: string[];
  action?: { label: string; url: string };
  footnote?: string;
}

function layout({ heading, paragraphs, action, footnote }: LayoutParams): { html: string; text: string } {
  const body = paragraphs.map((p) => `<p style="margin:0 0 16px;line-height:1.5">${escapeHtml(p)}</p>`).join("");
  const button = action
    ? `<p style="margin:24px 0"><a href="${escapeHtml(action.url)}" style="background:#2456d6;color:#ffffff;padding:12px 20px;border-radius:6px;text-decoration:none;font-weight:600;display:inline-block">${escapeHtml(action.label)}</a></p>` +
      `<p style="margin:0 0 16px;font-size:13px;color:#667085;line-height:1.5">If the button does not work, copy this link into your browser:<br>${escapeHtml(action.url)}</p>`
    : "";
  const foot = footnote
    ? `<p style="margin:24px 0 0;font-size:13px;color:#667085;line-height:1.5">${escapeHtml(footnote)}</p>`
    : "";
  const html =
    `<!doctype html><html><body style="margin:0;padding:24px;background:#f5f6f8;font-family:Arial,Helvetica,sans-serif;color:#1d2433">` +
    `<div style="max-width:520px;margin:0 auto;background:#ffffff;border-radius:10px;padding:32px">` +
    `<p style="margin:0 0 24px;font-weight:700;font-size:15px;color:#2456d6">${BRAND}</p>` +
    `<h1 style="margin:0 0 16px;font-size:20px">${escapeHtml(heading)}</h1>${body}${button}${foot}</div></body></html>`;
  const text = [heading, "", ...paragraphs, ...(action ? ["", `${action.label}: ${action.url}`] : []), ...(footnote ? ["", footnote] : [])].join("\n");
  return { html, text };
}

export function verifyEmailMessage(params: { to: string; name: string | null; url: string }): EmailMessage {
  const content = layout({
    heading: "Confirm your email address",
    paragraphs: [
      `Hi ${params.name ?? "there"},`,
      `Thanks for joining ${BRAND}. Confirm this email address to activate your account and sign in.`,
    ],
    action: { label: "Confirm email", url: params.url },
    footnote: "This link expires in 24 hours. If you did not create an account, you can ignore this email.",
  });
  return { to: params.to, subject: `Confirm your ${BRAND} email address`, ...content };
}

export function passwordResetMessage(params: { to: string; name: string | null; url: string }): EmailMessage {
  const content = layout({
    heading: "Reset your password",
    paragraphs: [
      `Hi ${params.name ?? "there"},`,
      "We received a request to reset the password for your account. Choose a new password with the button below.",
    ],
    action: { label: "Choose a new password", url: params.url },
    footnote:
      "This link expires in 1 hour and can be used once. If you did not ask for it, your password is unchanged and you can ignore this email.",
  });
  return { to: params.to, subject: `Reset your ${BRAND} password`, ...content };
}

export function existingAccountMessage(params: { to: string; loginUrl: string }): EmailMessage {
  const content = layout({
    heading: "You already have an account",
    paragraphs: [
      `Someone tried to create a ${BRAND} account with this email address, but one already exists.`,
      "If that was you, sign in instead. If you have forgotten your password, you can reset it from the sign-in page.",
    ],
    action: { label: "Sign in", url: params.loginUrl },
    footnote: "If this was not you, no action is needed. Your account has not been changed.",
  });
  return { to: params.to, subject: `Your ${BRAND} account`, ...content };
}

export function securityNoticeMessage(params: { to: string; name: string | null; event: string }): EmailMessage {
  const content = layout({
    heading: "Security change on your account",
    paragraphs: [`Hi ${params.name ?? "there"},`, params.event],
    footnote:
      "If you did not make this change, reset your password immediately and contact support, because someone else may have access to your account.",
  });
  return { to: params.to, subject: `${BRAND} security alert`, ...content };
}
