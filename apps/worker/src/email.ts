/**
 * Transactional e-mail through Resend's HTTP API (the same provider the web
 * app uses for account e-mails). Without RESEND_API_KEY the message is
 * logged instead, which keeps development self-contained.
 */
import { POWERED_BY } from "@marketplace/shared-types";

export interface OutgoingEmail {
  to: string;
  subject: string;
  heading: string;
  body: string | null;
  actionLabel: string;
  actionUrl: string;
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

export function renderEmail(email: OutgoingEmail, brand: string): { html: string; text: string } {
  const body = email.body ? `<p style="margin:0 0 20px;color:#3f3f46;font-size:15px;line-height:1.55">${escapeHtml(email.body)}</p>` : "";
  const html = `<!doctype html><html><body style="margin:0;background:#f4f4f5;font-family:-apple-system,Segoe UI,Roboto,Noto Sans Ethiopic,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="100%" style="max-width:520px;background:#ffffff;border-radius:12px;padding:28px" cellpadding="0" cellspacing="0"><tr><td>
<p style="margin:0 0 16px;font-weight:600;color:#18181b">${escapeHtml(brand)}</p>
<h1 style="margin:0 0 12px;font-size:20px;color:#18181b">${escapeHtml(email.heading)}</h1>
${body}
<a href="${escapeHtml(email.actionUrl)}" style="display:inline-block;background:#18181b;color:#ffffff;text-decoration:none;padding:10px 18px;border-radius:8px;font-size:14px">${escapeHtml(email.actionLabel)}</a>
<p style="margin:24px 0 0;color:#71717a;font-size:12px">You can turn these e-mails off in your notification settings.</p>
</td></tr></table>
<p style="margin:16px 0 0;color:#a1a1aa;font-size:12px">${escapeHtml(brand)} · ${escapeHtml(POWERED_BY)}</p>
</td></tr></table></body></html>`;
  const text = `${email.heading}\n\n${email.body ? `${email.body}\n\n` : ""}${email.actionLabel}: ${email.actionUrl}\n\nYou can turn these e-mails off in your notification settings.\n\n${brand} · ${POWERED_BY}`;
  return { html, text };
}

export async function sendEmail(apiKey: string | undefined, from: string, email: OutgoingEmail, brand: string): Promise<boolean> {
  const { html, text } = renderEmail(email, brand);
  if (!apiKey) {
    console.info(`[email:dev] To: ${email.to}\n[email:dev] Subject: ${email.subject}\n${text}`);
    return true;
  }
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from, to: [email.to], subject: email.subject, html, text }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) {
    // 4xx other than rate limiting will not succeed on retry.
    const detail = (await response.text()).slice(0, 300);
    if (response.status === 429 || response.status >= 500) throw new Error(`Resend ${response.status}: ${detail}`);
    console.error(`[email] Resend rejected "${email.subject}" (${response.status}): ${detail}`);
    return false;
  }
  return true;
}
