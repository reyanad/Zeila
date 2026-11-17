import "server-only";
import { asAttachments, type AttachmentRef } from "@marketplace/core";
import { prisma, type Prisma } from "@marketplace/database";
import { intakeFieldSchema, type IntakeField } from "@marketplace/shared-types";

export interface IntakeAnswerView {
  field: IntakeField;
  text: string | null;
  file: AttachmentRef | null;
}

export interface WorkView {
  orderItemId: string;
  status: string;
  revisionsAllowed: number;
  revisionsUsed: number;
  dueAt: Date | null;
  fields: IntakeField[];
  answers: IntakeAnswerView[] | null;
  answeredAt: Date | null;
  timeline: Array<
    | { kind: "delivery"; at: Date; message: string | null; files: AttachmentRef[] }
    | { kind: "revision"; at: Date; note: string; status: string }
  >;
}

function parseFields(value: Prisma.JsonValue | undefined): IntakeField[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((field) => {
    const parsed = intakeFieldSchema.safeParse(field);
    return parsed.success ? [parsed.data] : [];
  });
}

/** Everything both sides see about a service item: questions, answers, deliveries and revision rounds. */
export async function loadWork(orderItemId: string): Promise<WorkView | null> {
  const item = await prisma.orderItem.findUnique({
    where: { id: orderItemId },
    select: {
      id: true,
      status: true,
      listingType: true,
      variantSnapshot: true,
      listing: { select: { intakeForm: { select: { fields: true } } } },
      intakeResponse: { select: { answers: true, submittedAt: true } },
      deliverables: { orderBy: { submittedAt: "asc" }, select: { message: true, files: true, submittedAt: true } },
      revisions: { orderBy: { requestedAt: "asc" }, select: { note: true, status: true, requestedAt: true } },
      milestones: { orderBy: { position: "asc" }, take: 1, select: { dueAt: true } },
    },
  });
  if (!item || item.listingType !== "SERVICE") return null;

  const fields = parseFields(item.listing.intakeForm?.fields);
  const raw = item.intakeResponse?.answers;
  const stored = typeof raw === "object" && raw !== null && !Array.isArray(raw) ? (raw as Record<string, Prisma.JsonValue>) : null;
  const answers = stored
    ? fields.map((field) => {
        const value = stored[field.id];
        if (field.kind === "file") return { field, text: null, file: asAttachments(value === undefined ? [] : [value])[0] ?? null };
        return { field, text: typeof value === "string" ? value : null, file: null };
      })
    : null;
  const snapshot = (item.variantSnapshot ?? {}) as Record<string, unknown>;

  return {
    orderItemId: item.id,
    status: item.status,
    revisionsAllowed: typeof snapshot.revisions === "number" ? snapshot.revisions : 0,
    revisionsUsed: item.revisions.length,
    dueAt: item.milestones[0]?.dueAt ?? null,
    fields,
    answers,
    answeredAt: item.intakeResponse?.submittedAt ?? null,
    timeline: [
      ...item.deliverables.map((delivery) => ({ kind: "delivery" as const, at: delivery.submittedAt, message: delivery.message, files: asAttachments(delivery.files) })),
      ...item.revisions.map((revision) => ({ kind: "revision" as const, at: revision.requestedAt, note: revision.note, status: revision.status })),
    ].sort((a, b) => a.at.getTime() - b.at.getTime()),
  };
}

export function attachmentHref(orderItemId: string, file: AttachmentRef): string {
  return `/api/orders/${orderItemId}/files/download?key=${encodeURIComponent(file.key)}&name=${encodeURIComponent(file.fileName)}`;
}
