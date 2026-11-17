import { recordListingView } from "@marketplace/core";
import { prisma } from "@marketplace/database";
import { rateLimit } from "@/lib/rate-limit";
import { clientIpFromHeaders, isSameOrigin } from "@/lib/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BOT = /bot|crawl|spider|slurp|preview|facebookexternalhit|headless/i;

/** Count a listing view (one per browser session, sent by the page). */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  if (!isSameOrigin(request) || BOT.test(request.headers.get("user-agent") ?? "")) return new Response(null, { status: 204 });
  const { id } = await params;
  const limit = await rateLimit(`listing-view:${clientIpFromHeaders(request.headers)}`, 120, 60 * 60);
  if (!limit.allowed) return new Response(null, { status: 204 });
  const exists = await prisma.listing.count({ where: { id, status: "ACTIVE" } });
  if (exists > 0) await recordListingView(id, new Date());
  return new Response(null, { status: 204 });
}
