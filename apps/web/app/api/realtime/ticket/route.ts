import { getCurrentUser } from "@/lib/auth/session";
import { realtimeTicket, realtimeUrl } from "@/lib/realtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** A one-minute ticket the browser presents to the realtime gateway. */
export async function GET(): Promise<Response> {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Sign in again." }, { status: 401 });
  const url = realtimeUrl();
  if (!url) return Response.json({ error: "Real-time updates are not configured." }, { status: 404 });
  return Response.json({ ticket: realtimeTicket(user.id), url }, { headers: { "Cache-Control": "no-store" } });
}
