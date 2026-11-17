import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { prisma } from "@marketplace/database";
import { Alert, buttonVariants } from "@marketplace/ui";
import { OpenDisputeForm } from "@/components/disputes/open-dispute-form";
import { requireUser } from "@/lib/auth/session";
import { OPEN_STATUSES } from "@/lib/disputes/view";

export const metadata: Metadata = { title: "Report a problem", robots: { index: false } };
export const dynamic = "force-dynamic";

export default async function NewDisputePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const subOrderId = typeof params.subOrderId === "string" ? params.subOrderId : "";
  const user = await requireUser(`/disputes/new?subOrderId=${encodeURIComponent(subOrderId)}`);
  const subOrder = await prisma.subOrder.findFirst({
    where: { id: subOrderId, order: { buyerId: user.id }, status: { notIn: ["PENDING_PAYMENT", "CANCELLED"] } },
    select: {
      id: true,
      orderId: true,
      order: { select: { orderNumber: true } },
      store: { select: { name: true } },
      escrow: { select: { status: true } },
      items: { select: { id: true, titleSnapshot: true } },
      disputes: { where: { status: { in: OPEN_STATUSES } }, select: { id: true }, take: 1 },
    },
  });
  if (!subOrder) notFound();
  if (subOrder.disputes[0]) redirect(`/disputes/${subOrder.disputes[0].id}`);
  const canOpen = subOrder.escrow?.status === "HELD" || subOrder.escrow?.status === "FROZEN";

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Report a problem</h1>
        <p className="text-sm text-muted-foreground">
          Order {subOrder.order.orderNumber} from {subOrder.store.name}
        </p>
      </div>
      {canOpen ? (
        <>
          <Alert tone="info">Tip: message the seller first; most problems are fixed quickly. Open a case if that does not work.</Alert>
          <OpenDisputeForm subOrderId={subOrder.id} items={subOrder.items.map((item) => ({ id: item.id, title: item.titleSnapshot }))} />
        </>
      ) : (
        <Alert tone="warning">The seller has already been paid for this order, so a case can no longer be opened here. Contact support for help.</Alert>
      )}
      <Link href={`/orders/${subOrder.orderId}`} className={buttonVariants({ variant: "ghost", size: "sm" })}>
        Back to the order
      </Link>
    </div>
  );
}
