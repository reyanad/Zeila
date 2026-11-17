import { z } from "zod";
import { beginPasswordLogin, completeTicketLogin } from "@/lib/auth/login";
import { json } from "@/lib/mobile/auth";
import { issueMobileSession } from "@/lib/mobile/auth";
import { clientIpFromHeaders } from "@/lib/request";
import { prisma } from "@marketplace/database";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  password: z.string().min(1).max(200),
  deviceName: z.string().trim().max(80).optional(),
});

/** Step 1: e-mail and password. Returns a session token, or a ticket when a second factor is needed. */
export async function POST(request: Request): Promise<Response> {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return json({ error: "Enter your e-mail and password." }, 400);
  const ip = clientIpFromHeaders(request.headers);
  const result = await beginPasswordLogin(parsed.data.email, parsed.data.password, ip);
  switch (result.status) {
    case "invalid":
      return json({ error: "Wrong e-mail or password." }, 401);
    case "unverified":
      return json({ error: "Confirm your e-mail address first; we sent you a link." }, 403);
    case "suspended":
      return json({ error: "This account is suspended. Contact support." }, 403);
    case "rate_limited":
      return json({ error: "Too many attempts. Try again in a few minutes." }, 429);
    case "ok": {
      if (result.twoFactorRequired) return json({ twoFactorRequired: true, ticket: result.ticket });
      const user = await completeTicketLogin(result.ticket, undefined, ip);
      const full = await prisma.user.findUniqueOrThrow({ where: { id: user.id }, select: { id: true, sessionVersion: true } });
      const token = await issueMobileSession(full, parsed.data.deviceName ?? null);
      return json({ token, user: { id: user.id, email: user.email, name: user.name } });
    }
  }
}
