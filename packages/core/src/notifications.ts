import { prisma, type NotificationType } from "@marketplace/database";
import { enqueueNotificationJob } from "@marketplace/jobs";
import { publishToUsers } from "@marketplace/realtime";
import { formatMoney, isSupportedCurrency } from "@marketplace/shared-types";

/** Amount for notification text, e.g. "ETB 1,250.00". */
export function displayAmount(amount: number, currency: string): string {
  return isSupportedCurrency(currency) ? formatMoney({ amount, currency }) : `${(amount / 100).toFixed(2)} ${currency}`;
}

/**
 * In-app notifications with real-time push and e-mail. The database row is
 * the record; push and e-mail are best-effort, and a failure here never
 * breaks the business action that triggered it.
 */
export interface NotifyInput {
  userId: string;
  type: NotificationType;
  title: string;
  body?: string | null;
  href?: string | null;
  /** E-mail too (subject to the user's preference). Default true. */
  email?: boolean;
}

export async function notify(inputs: NotifyInput | readonly NotifyInput[]): Promise<void> {
  const list = (Array.isArray(inputs) ? inputs : [inputs]) as readonly NotifyInput[];
  if (list.length === 0) return;
  try {
    const created = await prisma.notification.createManyAndReturn({
      data: list.map((input) => ({
        userId: input.userId,
        type: input.type,
        title: input.title.slice(0, 200),
        body: input.body?.slice(0, 1_000) ?? null,
        payload: { href: input.href ?? null },
      })),
      select: { id: true, userId: true, title: true, body: true },
    });
    const userIds = [...new Set(created.map((notification) => notification.userId))];
    const counts = await prisma.notification.groupBy({ by: ["userId"], where: { userId: { in: userIds }, readAt: null }, _count: { _all: true } });
    const unread = new Map(counts.map((row) => [row.userId, row._count._all]));
    const redisUrl = process.env.REDIS_URL;
    await Promise.all(
      created.map(async (notification, index) => {
        const input = list[index];
        await publishToUsers([notification.userId], {
          type: "notification",
          id: notification.id,
          title: notification.title,
          body: notification.body,
          href: input?.href ?? null,
          unread: unread.get(notification.userId) ?? 1,
        });
        if (redisUrl) {
          await enqueueNotificationJob(redisUrl, { kind: "notification-push", notificationId: notification.id });
          if (input?.email !== false) await enqueueNotificationJob(redisUrl, { kind: "notification-email", notificationId: notification.id });
        }
      }),
    );
  } catch (error) {
    console.error("[notify] could not record notifications", error);
  }
}

export interface SubOrderParties {
  subOrderId: string;
  orderId: string;
  orderNumber: string;
  buyerId: string;
  sellerId: string;
  storeName: string;
}

export async function subOrderParties(subOrderId: string): Promise<SubOrderParties | null> {
  const subOrder = await prisma.subOrder.findUnique({
    where: { id: subOrderId },
    select: { id: true, orderId: true, order: { select: { orderNumber: true, buyerId: true } }, store: { select: { sellerId: true, name: true } } },
  });
  if (!subOrder) return null;
  return { subOrderId: subOrder.id, orderId: subOrder.orderId, orderNumber: subOrder.order.orderNumber, buyerId: subOrder.order.buyerId, sellerId: subOrder.store.sellerId, storeName: subOrder.store.name };
}

/** Notify the buyer or the seller of a sub-order, linking to their view of it. */
export async function notifySubOrder(subOrderId: string, to: "buyer" | "seller", input: Omit<NotifyInput, "userId" | "href"> & { href?: string }): Promise<void> {
  const parties = await subOrderParties(subOrderId).catch(() => null);
  if (!parties) return;
  const href = input.href ?? (to === "buyer" ? `/orders/${parties.orderId}` : `/seller/studio/orders/${parties.subOrderId}`);
  await notify({ ...input, userId: to === "buyer" ? parties.buyerId : parties.sellerId, href, title: input.title.replace("{order}", parties.orderNumber).replace("{store}", parties.storeName) });
}
