import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@marketplace/database";
import { Badge, buttonVariants } from "@marketplace/ui";
import { IntakeAnswersForm } from "@/components/orders/intake-answers-form";
import { ReviewDelivery } from "@/components/orders/review-delivery";
import { WorkThread } from "@/components/orders/work-thread";
import { requireUser } from "@/lib/auth/session";
import { loadWork } from "@/lib/orders/work";

export const metadata: Metadata = { title: "Service workspace", robots: { index: false } };
export const dynamic = "force-dynamic";

const STATUS: Record<string, { label: string; tone: "info" | "success" | "warning" | "neutral" }> = {
  PENDING: { label: "Waiting to start", tone: "warning" },
  FULFILLING: { label: "In progress", tone: "info" },
  DELIVERED: { label: "Delivered, review it", tone: "info" },
  COMPLETED: { label: "Completed", tone: "success" },
  REFUNDED: { label: "Refunded", tone: "neutral" },
  CANCELLED: { label: "Cancelled", tone: "neutral" },
  DISPUTED: { label: "In dispute", tone: "warning" },
};

export default async function WorkspacePage({ params }: { params: Promise<{ id: string; itemId: string }> }) {
  const { id, itemId } = await params;
  const user = await requireUser(`/orders/${id}/work/${itemId}`);
  const item = await prisma.orderItem.findFirst({
    where: { id: itemId, listingType: "SERVICE", subOrder: { orderId: id, order: { buyerId: user.id }, status: { not: "PENDING_PAYMENT" } } },
    select: { id: true, titleSnapshot: true, subOrder: { select: { store: { select: { name: true } }, order: { select: { orderNumber: true } } } } },
  });
  if (!item) notFound();
  const work = await loadWork(item.id);
  if (!work) notFound();
  const status = STATUS[work.status] ?? { label: work.status, tone: "neutral" as const };
  const initial = Object.fromEntries((work.answers ?? []).flatMap((answer) => (answer.text ? [[answer.field.id, answer.text]] : [])));
  const canAnswer = work.fields.length > 0 && (work.status === "PENDING" || work.status === "FULFILLING");
  const canRevise = work.revisionsAllowed < 0 || work.revisionsUsed < work.revisionsAllowed;

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{item.titleSnapshot}</h1>
          <p className="text-sm text-muted-foreground">
            {item.subOrder.store.name} · order {item.subOrder.order.orderNumber}
            {work.dueAt ? ` · due ${work.dueAt.toLocaleDateString("en-GB", { dateStyle: "medium" })}` : ""}
          </p>
        </div>
        <Badge tone={status.tone}>{status.label}</Badge>
      </div>
      <WorkThread work={work} viewer="buyer" />
      {canAnswer ? (
        <section className="flex flex-col gap-3 rounded-lg border border-border p-4" aria-label="Answer the seller's questions">
          <h2 className="font-medium">{work.answers ? "Update your answers" : "Answer the seller's questions"}</h2>
          <IntakeAnswersForm orderId={id} orderItemId={item.id} fields={work.fields} initial={initial} />
        </section>
      ) : null}
      {work.status === "DELIVERED" ? <ReviewDelivery orderId={id} orderItemId={item.id} canRevise={canRevise} /> : null}
      <Link href={`/orders/${id}`} className={buttonVariants({ variant: "ghost", size: "sm" })}>
        Back to the order
      </Link>
    </div>
  );
}
