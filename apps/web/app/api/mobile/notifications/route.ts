import { prisma } from "@marketplace/database";
import { absoluteUrl } from "@/lib/env";
import { json, withMobileUser } from "@/lib/mobile/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  return withMobileUser(request, async (user) => {
    const rows = await prisma.notification.findMany({ where: { userId: user.id }, orderBy: { createdAt: "desc" }, take: 100, select: { id: true, title: true, body: true, payload: true, readAt: true, createdAt: true } });
    return json({
      items: rows.map((row) => {
        const href = (row.payload as { href?: unknown } | null)?.href;
        const path = typeof href === "string" && href.startsWith("/") && !href.startsWith("//") ? href : null;
        return { id: row.id, title: row.title, body: row.body, read: row.readAt !== null, createdAt: row.createdAt.toISOString(), path, webUrl: path ? absoluteUrl(path) : null };
      }),
    });
  });
}

/** Mark some (ids) or all notifications as read. */
export async function POST(request: Request): Promise<Response> {
  return withMobileUser(request, async (user) => {
    const body = (await request.json().catch(() => ({}))) as { ids?: unknown };
    const ids = Array.isArray(body.ids) ? body.ids.filter((value): value is string => typeof value === "string").slice(0, 200) : null;
    await prisma.notification.updateMany({ where: { userId: user.id, readAt: null, ...(ids ? { id: { in: ids } } : {}) }, data: { readAt: new Date() } });
    return json({ ok: true });
  });
}
