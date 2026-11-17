import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@marketplace/database";
import { kycDocumentSchema } from "@marketplace/shared-types";
import { countryName } from "@/lib/storefront/detail";
import { Alert, Badge, buttonVariants } from "@marketplace/ui";
import { KycDecision } from "@/components/admin/kyc-decision";
import { requirePermission } from "@/lib/admin";
import { decryptField } from "@/lib/crypto/encryption";

export const metadata: Metadata = { title: "Identity check · Admin", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

const KIND_LABEL: Record<string, string> = { id_front: "ID (front)", id_back: "ID (back)", selfie: "Selfie with ID", proof_of_address: "Proof of address" };

function masked(stored: string): string {
  try {
    const value = decryptField(stored);
    return value.length <= 4 ? "••••" : `${"•".repeat(Math.min(8, value.length - 4))}${value.slice(-4)}`;
  } catch {
    return "unreadable";
  }
}

export default async function KycReviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const reviewer = await requirePermission("kyc:review", `/admin/kyc/${id}`);
  const submission = await prisma.kycSubmission.findUnique({
    where: { id },
    select: {
      id: true,
      status: true,
      legalName: true,
      birthDate: true,
      country: true,
      idType: true,
      idNumber: true,
      documents: true,
      rejectionReason: true,
      createdAt: true,
      userId: true,
      user: { select: { email: true, name: true, createdAt: true, store: { select: { name: true, status: true, payoutsEnabled: true } } } },
    },
  });
  if (!submission) notFound();
  const documents = (Array.isArray(submission.documents) ? submission.documents : []).flatMap((doc, index) => {
    const parsed = kycDocumentSchema.safeParse(doc);
    return parsed.success ? [{ ...parsed.data, index }] : [];
  });
  const previous = await prisma.kycSubmission.count({ where: { userId: submission.userId, id: { not: submission.id } } });

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-10">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">{submission.legalName}</h1>
        <Badge tone={submission.status === "APPROVED" ? "success" : submission.status === "REJECTED" ? "danger" : "warning"}>{submission.status.toLowerCase()}</Badge>
      </div>
      <dl className="grid gap-3 rounded-lg border border-border p-4 text-sm sm:grid-cols-3">
        <div>
          <dt className="text-xs text-muted-foreground">Account</dt>
          <dd>
            {submission.user.name ?? "—"} · {submission.user.email}
            <span className="block text-xs text-muted-foreground">joined {submission.user.createdAt.toLocaleDateString("en-GB", { dateStyle: "medium" })}</span>
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Store</dt>
          <dd>
            {submission.user.store ? `${submission.user.store.name} (${submission.user.store.status.toLowerCase()})` : "None"}
            <span className="block text-xs text-muted-foreground">payouts {submission.user.store?.payoutsEnabled ? "connected" : "not connected"}</span>
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Document</dt>
          <dd>
            {submission.idType.replace(/_/g, " ")} · {masked(submission.idNumber)}
            <span className="block text-xs text-muted-foreground">
              {countryName(submission.country)}
              {submission.birthDate ? ` · born ${submission.birthDate.toISOString().slice(0, 10)}` : ""}
            </span>
          </dd>
        </div>
      </dl>
      {previous > 0 ? <Alert tone="info">This person has {previous} earlier submission{previous === 1 ? "" : "s"}.</Alert> : null}
      <div className="grid gap-4 sm:grid-cols-2">
        {documents.map((doc) => (
          <figure key={doc.index} className="flex flex-col gap-2 rounded-lg border border-border p-3">
            <figcaption className="text-sm font-medium">{KIND_LABEL[doc.kind] ?? doc.kind}</figcaption>
            {doc.contentType === "application/pdf" ? (
              <a className={buttonVariants({ variant: "outline", size: "sm" })} href={`/api/admin/kyc/${submission.id}/${doc.index}`} target="_blank" rel="noopener noreferrer">
                Open PDF
              </a>
            ) : (
              // eslint-disable-next-line @next/next/no-img-element -- private, decrypted on request; not optimisable
              <img src={`/api/admin/kyc/${submission.id}/${doc.index}`} alt={KIND_LABEL[doc.kind] ?? doc.kind} className="max-h-96 w-full rounded object-contain" />
            )}
          </figure>
        ))}
      </div>
      {submission.status === "PENDING" ? (
        submission.userId === reviewer.id ? (
          <Alert tone="warning">You cannot review your own identity check.</Alert>
        ) : (
          <KycDecision submissionId={submission.id} />
        )
      ) : submission.rejectionReason ? (
        <Alert tone="info">Rejected: {submission.rejectionReason}</Alert>
      ) : null}
      <Link href="/admin/kyc" className={buttonVariants({ variant: "ghost", size: "sm" })}>
        Back to the queue
      </Link>
    </div>
  );
}
