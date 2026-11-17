import { prisma } from "@marketplace/database";
import { json, mobileUser, revokeMobileSession } from "@/lib/mobile/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** End this device's session and stop its push notifications. */
export async function POST(request: Request): Promise<Response> {
  const user = await mobileUser(request);
  if (!user) return json({ ok: true });
  const body = (await request.json().catch(() => ({}))) as { pushToken?: unknown };
  if (typeof body.pushToken === "string") await prisma.pushToken.deleteMany({ where: { token: body.pushToken, userId: user.id } });
  await revokeMobileSession(user.sessionId);
  return json({ ok: true });
}
