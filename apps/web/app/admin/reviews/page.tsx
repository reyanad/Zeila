import type { Metadata } from "next";
import Link from "next/link";
import { prisma } from "@marketplace/database";
import { Badge } from "@marketplace/ui";
import { ActionButton } from "@/components/action-button";
import { setReviewStatusAction } from "@/lib/actions/admin";
import { requirePermission } from "@/lib/admin";

export const metadata: Metadata = { title: "Reviews · Admin", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function ReviewModerationPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requirePermission("review:moderate", "/admin/reviews");
  const params = await searchParams;
  const filter = params.filter === "hidden" ? "hidden" : params.filter === "low" ? "low" : "recent";
  const reviews = await prisma.review.findMany({
    where: filter === "hidden" ? { status: "REJECTED" } : filter === "low" ? { status: "PUBLISHED", rating: { lte: 2 } } : { status: "PUBLISHED" },
    orderBy: { createdAt: "desc" },
    take: 100,
    select: { id: true, rating: true, title: true, body: true, sellerReply: true, status: true, createdAt: true, author: { select: { name: true, email: true } }, listing: { select: { title: true, slug: true } } },
  });
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-10">
      <h1 className="text-2xl font-semibold tracking-tight">Reviews</h1>
      <nav aria-label="Filter" className="flex gap-2">
        {(["recent", "low", "hidden"] as const).map((key) => (
          <Link
            key={key}
            href={`/admin/reviews?filter=${key}`}
            aria-current={key === filter ? "page" : undefined}
            className={`rounded-full px-3 py-1 text-sm ${key === filter ? "bg-primary text-primary-foreground" : "bg-muted hover:bg-accent"}`}
          >
            {key === "recent" ? "Recent" : key === "low" ? "1–2 stars" : "Hidden"}
          </Link>
        ))}
      </nav>
      <p className="text-sm text-muted-foreground">Hide reviews that are abusive, fake, off-topic or contain personal data. Negative but honest reviews stay.</p>
      {reviews.length === 0 ? (
        <p className="rounded-md border border-dashed border-border p-8 text-center text-sm text-muted-foreground">Nothing here.</p>
      ) : (
        <ul className="flex flex-col divide-y divide-border rounded-md border border-border">
          {reviews.map((review) => (
            <li key={review.id} className="flex flex-col gap-1 p-4 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span>
                  <span className="text-amber-500">{"★".repeat(review.rating)}</span>
                  <span className="text-muted-foreground/40">{"★".repeat(5 - review.rating)}</span> {review.title ? <strong>{review.title}</strong> : null}
                </span>
                <Badge tone={review.status === "PUBLISHED" ? "success" : "neutral"}>{review.status.toLowerCase()}</Badge>
              </div>
              <p className="text-xs text-muted-foreground">
                {review.author.name ?? review.author.email} on{" "}
                <Link className="underline underline-offset-4" href={`/listing/${review.listing.slug}`}>
                  {review.listing.title}
                </Link>{" "}
                · {review.createdAt.toLocaleDateString("en-GB", { dateStyle: "medium" })}
              </p>
              {review.body ? <p className="whitespace-pre-wrap">{review.body}</p> : null}
              {review.sellerReply ? <p className="rounded bg-muted px-3 py-2">Seller: {review.sellerReply}</p> : null}
              <div>
                {review.status === "PUBLISHED" ? (
                  <ActionButton variant="outline" action={setReviewStatusAction.bind(null, review.id, "REJECTED")} label="Hide" confirm="Hide this review from the listing? The rating is recalculated." />
                ) : (
                  <ActionButton variant="outline" action={setReviewStatusAction.bind(null, review.id, "PUBLISHED")} label="Restore" />
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
