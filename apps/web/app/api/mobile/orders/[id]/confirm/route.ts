import { CheckoutError, confirmReceived } from "@marketplace/core";
import { prisma } from "@marketplace/database";
import { recordAudit } from "@/lib/audit";
import { json, withMobileUser } from "@/lib/mobile/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The buyer confirms delivery of one store's part of the order, releasing the seller's payment. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await params;
  return withMobileUser(request, async (user) => {
    const body = (await request.json().catch(() => ({}))) as { subOrderId?: unknown };
    const subOrderId = typeof body.subOrderId === "string" ? body.subOrderId : "";
    const owned = await prisma.subOrder.count({ where: { id: subOrderId, orderId: id, order: { buyerId: user.id } } });
    if (owned === 0) return json({ error: "Not found" }, 404);
    try {
      await confirmReceived(user.id, subOrderId, new Date());
    } catch (error) {
      if (error instanceof CheckoutError) return json({ error: error.message }, 409);
      throw error;
    }
    await recordAudit({ actorId: user.id, action: "order.confirm-received", entity: "SubOrder", entityId: subOrderId, data: { via: "mobile" } });
    return json({ ok: true });
  });
}
