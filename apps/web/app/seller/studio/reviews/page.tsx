import type { Metadata } from "next";
import Link from "next/link";
import { prisma } from "@marketplace/database";
import { ReviewReply } from "@/components/growth/review-reply";
import { Rating } from "@/components/storefront/listing-card";
import { requireStudio } from "@/lib/studio/context";

export const metadata: Metadata = { title: "Reviews" };
export const dynamic = "force-dynamic";

export default async function StudioReviewsPage() {
  const { store, user } = await requireStudio("/seller/studio/reviews");
  const [reviews, stats] = await Promise.all([
    prisma.review.findMany({
      where: { subjectId: user.id, status: "PUBLISHED" },
      orderBy: { createdAt: "desc" },
      take: 100,
      select: { id: true, rating: true, title: true, body: true, sellerReply: true, createdAt: true, author: { select: { name: true } }, listing: { select: { title: true, slug: true } } },
    }),
    prisma.review.aggregate({ where: { subjectId: user.id, status: "PUBLISHED" }, _avg: { rating: true }, _count: { _all: true } }),
  ]);
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-baseline gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">Reviews</h1>
        <Rating average={stats._avg.rating ?? 0} count={stats._count._all} />
      </div>
      <p className="text-sm text-muted-foreground">Reviews come only from buyers of {store.name} who received their order. A short, polite reply helps future buyers.</p>
      {reviews.length === 0 ? (
        <p className="rounded-md border border-dashed border-border p-10 text-center text-sm text-muted-foreground">No reviews yet.</p>
      ) : (
        <ul className="flex flex-col divide-y divide-border rounded-md border border-border">
          {reviews.map((review) => (
            <li key={review.id} className="flex flex-col gap-1 p-4 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-amber-500" aria-label={`${review.rating} out of 5`}>
                  {"★".repeat(review.rating)}
                  <span className="text-muted-foreground/40">{"★".repeat(5 - review.rating)}</span>
                </span>
                {review.title ? <span className="font-medium">{review.title}</span> : null}
              </div>
              <p className="text-xs text-muted-foreground">
                {review.author.name ?? "Buyer"} on{" "}
                <Link className="underline underline-offset-4" href={`/listing/${review.listing.slug}`}>
                  {review.listing.title}
                </Link>{" "}
                · {review.createdAt.toLocaleDateString("en-GB", { dateStyle: "medium" })}
              </p>
              {review.body ? <p className="whitespace-pre-wrap">{review.body}</p> : null}
              {review.sellerReply ? <p className="rounded bg-muted px-3 py-2">Your reply: {review.sellerReply}</p> : null}
              <div>
                <ReviewReply reviewId={review.id} existing={review.sellerReply} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
