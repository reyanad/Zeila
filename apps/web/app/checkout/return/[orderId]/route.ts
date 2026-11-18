import { NextResponse } from "next/server";
import { confirmPayment } from "@marketplace/core";
import { prisma } from "@marketplace/database";
import { getCurrentUser } from "@/lib/auth/session";
import { getChapa } from "@/lib/chapa";
import { appUrl } from "@/lib/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Chapa sends the buyer here after checkout. Coming back does not mean the
 * payment succeeded, so the latest attempt is checked with Chapa first.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ orderId: string }> }): Promise<NextResponse> {
  const { orderId } = await params;
  const user = await getCurrentUser();
  if (!user) return NextResponse.redirect(appUrl(`/login?callbackUrl=${encodeURIComponent(`/orders/${orderId}`)}`));

  const order = await prisma.order.findFirst({
    where: { id: orderId, buyerId: user.id },
    select: { id: true, status: true, payments: { orderBy: { createdAt: "desc" }, take: 1, select: { providerRef: true } } },
  });
  if (!order) return NextResponse.redirect(appUrl("/orders"));
  if (order.status !== "PENDING_PAYMENT") return NextResponse.redirect(appUrl(`/orders/${order.id}`));

  const chapa = getChapa();
  const latest = order.payments[0];
  if (!chapa || !latest) return NextResponse.redirect(appUrl(`/checkout/pay/${order.id}`));
  try {
    const outcome = await confirmPayment(chapa, latest.providerRef, new Date());
    if (outcome === "paid") return NextResponse.redirect(appUrl(`/orders/${order.id}?paid=1`));
    if (outcome === "refunded") return NextResponse.redirect(appUrl(`/orders/${order.id}`));
    return NextResponse.redirect(appUrl(`/checkout/pay/${order.id}?payment=${outcome === "pending" ? "pending" : outcome === "failed" ? "failed" : "cancelled"}`));
  } catch (error) {
    console.error(`[payments] could not confirm order ${order.id} on return`, error);
    return NextResponse.redirect(appUrl(`/checkout/pay/${order.id}?payment=pending`));
  }
}
