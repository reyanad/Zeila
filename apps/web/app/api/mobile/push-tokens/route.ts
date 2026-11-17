import { z } from "zod";
import { prisma } from "@marketplace/database";
import { json, withMobileUser } from "@/lib/mobile/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({ token: z.string().regex(/^Expo(nent)?PushToken\[[A-Za-z0-9_-]{10,200}\]$/), platform: z.enum(["ios", "android"]) });

/** Register this device for push notifications (a token moves to the newest signed-in user). */
export async function POST(request: Request): Promise<Response> {
  return withMobileUser(request, async (user) => {
    const parsed = schema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return json({ error: "Invalid push token." }, 400);
    await prisma.pushToken.upsert({
      where: { token: parsed.data.token },
      create: { userId: user.id, token: parsed.data.token, platform: parsed.data.platform },
      update: { userId: user.id, platform: parsed.data.platform, lastSeenAt: new Date() },
    });
    return json({ ok: true });
  });
}

export async function DELETE(request: Request): Promise<Response> {
  return withMobileUser(request, async (user) => {
    const body = (await request.json().catch(() => ({}))) as { token?: unknown };
    if (typeof body.token === "string") await prisma.pushToken.deleteMany({ where: { token: body.token, userId: user.id } });
    return json({ ok: true });
  });
}
