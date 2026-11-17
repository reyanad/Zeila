import type { Processor } from "bullmq";
import { prisma } from "@marketplace/database";
import type { NotificationJob } from "@marketplace/jobs";
import { sendEmail } from "../email";

export interface NotificationSettings {
  resendApiKey: string | undefined;
  emailFrom: string;
  appUrl: string;
  brand: string;
}

const MESSAGE_EMAIL_GAP_MS = 30 * 60_000;

function absolute(appUrl: string, href: string | null): string {
  if (!href) return appUrl;
  try {
    return new URL(href, appUrl).toString();
  } catch {
    return appUrl;
  }
}

export function notificationProcessor(settings: NotificationSettings): Processor<NotificationJob, string> {
  return async (job) => {
    const data = job.data;
    if (data.kind === "notification-email") {
      const notification = await prisma.notification.findUnique({
        where: { id: data.notificationId },
        select: { id: true, title: true, body: true, payload: true, emailedAt: true, readAt: true, user: { select: { email: true, emailNotifications: true, isSuspended: true } } },
      });
      if (!notification) return "gone";
      if (notification.emailedAt) return "already e-mailed";
      if (!notification.user.emailNotifications || notification.user.isSuspended) return "e-mail turned off";
      const payload = (notification.payload ?? {}) as { href?: unknown };
      const href = typeof payload.href === "string" ? payload.href : null;
      const sent = await sendEmail(
        settings.resendApiKey,
        settings.emailFrom,
        { to: notification.user.email, subject: notification.title, heading: notification.title, body: notification.body, actionLabel: "Open", actionUrl: absolute(settings.appUrl, href) },
        settings.brand,
      );
      if (sent) await prisma.notification.update({ where: { id: notification.id }, data: { emailedAt: new Date() } });
      return sent ? "sent" : "rejected";
    }

    const participant = await prisma.conversationParticipant.findUnique({
      where: { conversationId_userId: { conversationId: data.conversationId, userId: data.recipientId } },
      select: {
        id: true,
        lastReadAt: true,
        lastEmailedAt: true,
        isMuted: true,
        user: { select: { email: true, emailNotifications: true, isSuspended: true } },
        conversation: {
          select: {
            messages: { where: { senderId: { not: data.recipientId } }, orderBy: { createdAt: "desc" }, take: 1, select: { createdAt: true, sender: { select: { name: true } } } },
          },
        },
      },
    });
    const latest = participant?.conversation.messages[0];
    if (!participant || !latest) return "gone";
    if (participant.isMuted || !participant.user.emailNotifications || participant.user.isSuspended) return "e-mail turned off";
    if (participant.lastReadAt && participant.lastReadAt >= latest.createdAt) return "already read";
    if (participant.lastEmailedAt && Date.now() - participant.lastEmailedAt.getTime() < MESSAGE_EMAIL_GAP_MS) return "e-mailed recently";
    const from = latest.sender.name ?? "Someone";
    const sent = await sendEmail(
      settings.resendApiKey,
      settings.emailFrom,
      {
        to: participant.user.email,
        subject: `New message from ${from}`,
        heading: `${from} sent you a message`,
        body: "Reply on the site. For your protection, keep payments and contact details on the platform.",
        actionLabel: "Read and reply",
        actionUrl: absolute(settings.appUrl, `/messages/${data.conversationId}`),
      },
      settings.brand,
    );
    if (sent) await prisma.conversationParticipant.update({ where: { id: participant.id }, data: { lastEmailedAt: new Date() } });
    return sent ? "sent" : "rejected";
  };
}
