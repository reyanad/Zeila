import { prisma, Prisma } from "@marketplace/database";
import { screenMessage } from "@marketplace/shared-types";
import { CheckoutError } from "./errors";
import { notify } from "./notifications";

/**
 * Verified reviews: only the buyer of a delivered item can review it, once
 * per item (editable for 30 days). The listing's rating is recomputed from
 * published reviews in the same transaction.
 */

export const REVIEW_EDIT_DAYS = 30;

export interface ReviewInput {
  rating: number;
  title: string;
  body: string;
}

async function recomputeRating(tx: Prisma.TransactionClient, listingId: string): Promise<void> {
  const stats = await tx.review.aggregate({ where: { listingId, status: "PUBLISHED" }, _avg: { rating: true }, _count: { _all: true } });
  const average = stats._avg.rating ?? 0;
  await tx.listing.update({ where: { id: listingId }, data: { ratingAvg: new Prisma.Decimal(average.toFixed(2)), ratingCount: stats._count._all } });
}

export async function submitReview(buyerId: string, orderItemId: string, input: ReviewInput, now: Date): Promise<{ listingId: string }> {
  const item = await prisma.orderItem.findFirst({
    where: { id: orderItemId, subOrder: { order: { buyerId } } },
    select: { id: true, listingId: true, listingType: true, status: true, titleSnapshot: true, subOrder: { select: { status: true, store: { select: { sellerId: true } } } } },
  });
  if (!item) throw new CheckoutError("That purchase does not exist.");
  const reviewable = item.listingType === "SERVICE" ? item.status === "COMPLETED" : item.status === "DELIVERED" || item.status === "COMPLETED";
  if (!reviewable || item.subOrder.status === "REFUNDED") {
    throw new CheckoutError(item.listingType === "SERVICE" ? "You can review the service once the work is approved." : "You can review this once it has been delivered.");
  }
  if (!Number.isInteger(input.rating) || input.rating < 1 || input.rating > 5) throw new CheckoutError("Choose 1 to 5 stars.");
  const title = screenMessage(input.title.trim()).text.slice(0, 120);
  const body = screenMessage(input.body.trim()).text;
  if (body.length > 3_000) throw new CheckoutError("Reviews can be at most 3,000 characters.");
  if (input.rating <= 2 && body.length < 10) throw new CheckoutError("Tell other buyers what went wrong (at least 10 characters).");

  const existing = await prisma.review.findUnique({ where: { orderItemId_authorId: { orderItemId: item.id, authorId: buyerId } }, select: { id: true, createdAt: true, status: true } });
  if (existing && now.getTime() - existing.createdAt.getTime() > REVIEW_EDIT_DAYS * 86_400_000) throw new CheckoutError(`Reviews can be edited for ${REVIEW_EDIT_DAYS} days.`);
  if (existing?.status === "REJECTED") throw new CheckoutError("This review was removed by moderators and cannot be edited.");

  await prisma.$transaction(async (tx) => {
    await tx.review.upsert({
      where: { orderItemId_authorId: { orderItemId: item.id, authorId: buyerId } },
      create: { orderItemId: item.id, listingId: item.listingId, authorId: buyerId, subjectId: item.subOrder.store.sellerId, rating: input.rating, title: title || null, body: body || null, status: "PUBLISHED" },
      update: { rating: input.rating, title: title || null, body: body || null },
    });
    await recomputeRating(tx, item.listingId);
  });
  if (!existing) {
    await notify({ userId: item.subOrder.store.sellerId, type: "REVIEW_RECEIVED", title: `New ${input.rating}-star review`, body: `${item.titleSnapshot}${title ? `: ${title}` : ""}`, href: "/seller/studio/reviews", email: input.rating <= 3 });
  }
  return { listingId: item.listingId };
}

export async function replyToReview(sellerId: string, reviewId: string, reply: string, now: Date): Promise<void> {
  const text = screenMessage(reply.trim()).text;
  if (text.length < 2 || text.length > 1_500) throw new CheckoutError("Replies are 2 to 1,500 characters.");
  const updated = await prisma.review.updateMany({ where: { id: reviewId, subjectId: sellerId, status: "PUBLISHED" }, data: { sellerReply: text, sellerRepliedAt: now } });
  if (updated.count === 0) throw new CheckoutError("That review does not exist.");
}

/** Moderation (Phase 10 uses this): hide or restore a review and refresh the rating. */
export async function setReviewStatus(reviewId: string, status: "PUBLISHED" | "REJECTED"): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const review = await tx.review.update({ where: { id: reviewId }, data: { status }, select: { listingId: true } });
    await recomputeRating(tx, review.listingId);
  });
}
