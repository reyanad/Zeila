import type { Metadata } from "next";
import Link from "next/link";
import { prisma } from "@marketplace/database";
import { Button } from "@marketplace/ui";
import { EmailToggle } from "@/components/notifications/email-toggle";
import { markAllNotificationsReadAction } from "@/lib/actions/notifications";
import { requireUser } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Notifications", robots: { index: false } };
export const dynamic = "force-dynamic";

export default async function NotificationsPage() {
  const user = await requireUser("/notifications");
  const [notifications, settings] = await Promise.all([
    prisma.notification.findMany({ where: { userId: user.id }, orderBy: { createdAt: "desc" }, take: 100, select: { id: true, title: true, body: true, readAt: true, createdAt: true } }),
    prisma.user.findUniqueOrThrow({ where: { id: user.id }, select: { emailNotifications: true } }),
  ]);
  const unread = notifications.filter((notification) => !notification.readAt).length;

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">Notifications</h1>
        {unread > 0 ? (
          <form action={markAllNotificationsReadAction}>
            <Button type="submit" variant="outline" size="sm">
              Mark all as read
            </Button>
          </form>
        ) : null}
      </div>
      <EmailToggle initial={settings.emailNotifications} />
      {notifications.length === 0 ? (
        <p className="rounded-md border border-dashed border-border p-10 text-center text-sm text-muted-foreground">Nothing yet. Order updates and replies appear here.</p>
      ) : (
        <ul className="flex flex-col divide-y divide-border rounded-md border border-border">
          {notifications.map((notification) => (
            <li key={notification.id}>
              <Link href={`/notifications/${notification.id}`} className="flex gap-3 p-4 hover:bg-accent" prefetch={false}>
                <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${notification.readAt ? "bg-transparent" : "bg-primary"}`} aria-hidden="true" />
                <span className="flex min-w-0 flex-col">
                  <span className={notification.readAt ? "" : "font-semibold"}>{notification.title}</span>
                  {notification.body ? <span className="text-sm text-muted-foreground">{notification.body}</span> : null}
                  <time className="text-xs text-muted-foreground" dateTime={notification.createdAt.toISOString()}>
                    {notification.createdAt.toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}
                  </time>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
