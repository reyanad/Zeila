import { NextResponse } from "next/server";
import { prisma } from "@marketplace/database";
import { getCurrentUser } from "@/lib/auth/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Open a notification: mark it read and go to what it is about (same-site paths only). */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await params;
  const user = await getCurrentUser();
  const base = new URL(request.url);
  if (!user) return NextResponse.redirect(new URL(`/login?callbackUrl=${encodeURIComponent(`/notifications/${id}`)}`, base));
  const notification = await prisma.notification.findFirst({ where: { id, userId: user.id }, select: { id: true, readAt: true, payload: true } });
  if (!notification) return NextResponse.redirect(new URL("/notifications", base));
  if (!notification.readAt) await prisma.notification.update({ where: { id: notification.id }, data: { readAt: new Date() } });
  const href = (notification.payload as { href?: unknown } | null)?.href;
  const safe = typeof href === "string" && href.startsWith("/") && !href.startsWith("//") ? href : "/notifications";
  return NextResponse.redirect(new URL(safe, base));
}
