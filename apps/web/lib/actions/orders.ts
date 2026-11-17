"use server";

import { revalidatePath } from "next/cache";
import { CheckoutError, confirmReceived } from "@marketplace/core";
import { recordAudit } from "@/lib/audit";
import { authorize } from "@/lib/auth/session";
import { getClientIp } from "@/lib/request";

export type OrderActionResult = { ok: true } | { ok: false; message: string };

/** Buyer confirms the goods arrived (or the work is accepted): the seller is paid now. */
export async function confirmReceivedAction(orderId: string, subOrderId: string): Promise<OrderActionResult> {
  const auth = await authorize("order:view-own");
  if (!auth.ok) return { ok: false, message: auth.message };
  try {
    await confirmReceived(auth.user.id, subOrderId, new Date());
  } catch (error) {
    if (error instanceof CheckoutError) return { ok: false, message: error.message };
    throw error;
  }
  await recordAudit({ actorId: auth.user.id, action: "order.confirm-received", entity: "SubOrder", entityId: subOrderId, ipAddress: await getClientIp() });
  revalidatePath(`/orders/${orderId}`);
  return { ok: true };
}
