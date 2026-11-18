import { NextResponse, type NextRequest } from "next/server";
import { confirmPayment } from "@marketplace/core";
import { getChapa } from "@/lib/chapa";
import { rateLimit } from "@/lib/rate-limit";
import { clientIpFromHeaders } from "@/lib/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Chapa calls this (GET ?trx_ref=…&ref_id=…&status=…) when a payment changes.
 * The query is only a hint: the payment is confirmed with Chapa's verify
 * endpoint before anything is applied, so a forged call changes nothing.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const chapa = getChapa();
  if (!chapa) return NextResponse.json({ error: "Chapa is not configured" }, { status: 503 });
  const limit = await rateLimit(`chapa-callback:${clientIpFromHeaders(request.headers)}`, 120, 60);
  if (!limit.allowed) return NextResponse.json({ error: "Too many requests" }, { status: 429 });

  const txRef = request.nextUrl.searchParams.get("trx_ref") ?? request.nextUrl.searchParams.get("tx_ref");
  if (!txRef || txRef.length > 200) return NextResponse.json({ error: "Missing trx_ref" }, { status: 400 });
  try {
    const outcome = await confirmPayment(chapa, txRef, new Date());
    return NextResponse.json({ received: true, outcome });
  } catch (error) {
    console.error(`[payments] callback for ${txRef} failed`, error);
    return NextResponse.json({ error: "Could not confirm the payment" }, { status: 500 });
  }
}
