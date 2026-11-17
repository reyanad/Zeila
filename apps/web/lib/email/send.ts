import "server-only";
import { getEnv, isProduction, resendApiKey } from "@/lib/env";

export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
}

export interface EmailResult {
  delivered: boolean;
  id?: string;
}

const RESEND_ENDPOINT = "https://api.resend.com/emails";

/**
 * Send a transactional e-mail through Resend's HTTP API. Without an API key
 * (local development) the message is printed to the server log instead, so
 * verification and reset links stay usable without an e-mail account.
 */
export async function sendEmail(message: EmailMessage): Promise<EmailResult> {
  const apiKey = resendApiKey();
  if (!apiKey) {
    if (isProduction()) {
      console.error(`[email] RESEND_API_KEY is not configured; "${message.subject}" to ${message.to} was not sent.`);
      return { delivered: false };
    }
    console.info(`\n[email:dev] To: ${message.to}\n[email:dev] Subject: ${message.subject}\n${message.text}\n`);
    return { delivered: true, id: "dev-console" };
  }

  try {
    const response = await fetch(RESEND_ENDPOINT, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: getEnv().EMAIL_FROM,
        to: [message.to],
        subject: message.subject,
        html: message.html,
        text: message.text,
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      const detail = (await response.text()).slice(0, 300);
      console.error(`[email] Resend rejected "${message.subject}" (${response.status}): ${detail}`);
      return { delivered: false };
    }
    const body = (await response.json()) as { id?: string };
    return { delivered: true, id: body.id };
  } catch (error) {
    console.error(`[email] failed to send "${message.subject}"`, error);
    return { delivered: false };
  }
}
