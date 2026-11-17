import { prisma } from "@marketplace/database";
import { Rating } from "@/components/storefront/listing-card";

/** Published, verified-purchase reviews for a listing with the rating breakdown. */
export async function ListingReviews({ listingId, average, count }: { listingId: string; average: number; count: number }) {
  const [reviews, distribution] = await Promise.all([
    prisma.review.findMany({
      where: { listingId, status: "PUBLISHED" },
      orderBy: { createdAt: "desc" },
      take: 20,
      select: { id: true, rating: true, title: true, body: true, sellerReply: true, createdAt: true, author: { select: { name: true } } },
    }),
    prisma.review.groupBy({ by: ["rating"], where: { listingId, status: "PUBLISHED" }, _count: { _all: true } }),
  ]);
  const byStars = new Map(distribution.map((row) => [row.rating, row._count._all]));
  return (
    <section aria-labelledby="reviews-heading" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-baseline gap-3">
        <h2 id="reviews-heading" className="text-xl font-semibold tracking-tight">
          Reviews
        </h2>
        <Rating average={average} count={count} />
      </div>
      {count === 0 ? (
        <p className="text-sm text-muted-foreground">No reviews yet. Only buyers who received this can review it.</p>
      ) : (
        <div className="grid gap-6 md:grid-cols-[200px_1fr]">
          <ul className="flex flex-col gap-1 text-sm" aria-label="Rating breakdown">
            {[5, 4, 3, 2, 1].map((stars) => {
              const share = count > 0 ? Math.round(((byStars.get(stars) ?? 0) / count) * 100) : 0;
              return (
                <li key={stars} className="flex items-center gap-2">
                  <span className="w-8 tabular-nums">{stars}★</span>
                  <span className="h-2 flex-1 overflow-hidden rounded bg-muted" aria-hidden="true">
                    <span className="block h-full bg-amber-500" style={{ width: `${share}%` }} />
                  </span>
                  <span className="w-10 text-right text-xs tabular-nums text-muted-foreground">{share}%</span>
                </li>
              );
            })}
          </ul>
          <ol className="flex flex-col divide-y divide-border">
            {reviews.map((review) => (
              <li key={review.id} className="flex flex-col gap-1 py-3 text-sm first:pt-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-amber-500" aria-label={`${review.rating} out of 5`}>
                    {"★".repeat(review.rating)}
                    <span className="text-muted-foreground/40">{"★".repeat(5 - review.rating)}</span>
                  </span>
                  {review.title ? <span className="font-medium">{review.title}</span> : null}
                </div>
                <p className="text-xs text-muted-foreground">
                  {review.author.name ?? "Buyer"} · verified purchase · {review.createdAt.toLocaleDateString("en-GB", { dateStyle: "medium" })}
                </p>
                {review.body ? <p className="whitespace-pre-wrap">{review.body}</p> : null}
                {review.sellerReply ? <p className="mt-1 rounded bg-muted px-3 py-2 text-sm">Seller: {review.sellerReply}</p> : null}
              </li>
            ))}
          </ol>
        </div>
      )}
    </section>
  );
}
