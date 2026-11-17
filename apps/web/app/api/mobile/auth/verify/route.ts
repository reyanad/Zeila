import { z } from "zod";
import { prisma } from "@marketplace/database";
import { completeTicketLogin, TicketLoginError } from "@/lib/auth/login";
import { issueMobileSession, json } from "@/lib/mobile/auth";
import { clientIpFromHeaders } from "@/lib/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({ ticket: z.string().min(10).max(2_000), code: z.string().trim().min(6).max(20), deviceName: z.string().trim().max(80).optional() });

const MESSAGES = {
  ticket_expired: "Your sign-in timed out. Start again.",
  code_required: "Enter the code from your authenticator app.",
  invalid_code: "That code is not right.",
  rate_limited: "Too many attempts. Try again in a few minutes.",
  suspended: "This account is suspended. Contact support.",
} as const;

/** Step 2: the authenticator (or recovery) code. */
export async function POST(request: Request): Promise<Response> {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return json({ error: "Enter the 6-digit code." }, 400);
  try {
    const user = await completeTicketLogin(parsed.data.ticket, parsed.data.code, clientIpFromHeaders(request.headers));
    const full = await prisma.user.findUniqueOrThrow({ where: { id: user.id }, select: { id: true, sessionVersion: true } });
    const token = await issueMobileSession(full, parsed.data.deviceName ?? null);
    return json({ token, user: { id: user.id, email: user.email, name: user.name } });
  } catch (error) {
    if (error instanceof TicketLoginError) return json({ error: MESSAGES[error.reason] }, error.reason === "rate_limited" ? 429 : 401);
    throw error;
  }
}
