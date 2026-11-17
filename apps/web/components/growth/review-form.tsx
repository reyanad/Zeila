"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Alert, Button, Input, Label, Textarea } from "@marketplace/ui";
import { submitReviewAction } from "@/lib/actions/growth";

export function ReviewForm({ orderId, orderItemId, initial }: { orderId: string; orderItemId: string; initial: { rating: number; title: string; body: string } | null }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [rating, setRating] = useState(initial?.rating ?? 0);
  const [title, setTitle] = useState(initial?.title ?? "");
  const [body, setBody] = useState(initial?.body ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (!open) {
    return (
      <div className="flex flex-wrap items-center gap-2 text-sm">
        {initial ? (
          <span className="text-amber-500" aria-label={`You rated ${initial.rating} out of 5`}>
            {"★".repeat(initial.rating)}
            <span className="text-muted-foreground/40">{"★".repeat(5 - initial.rating)}</span>
          </span>
        ) : null}
        <Button size="sm" variant="ghost" onClick={() => setOpen(true)}>
          {initial ? "Edit your review" : "Write a review"}
        </Button>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-3 rounded-md border border-border p-3">
      {error ? <Alert tone="danger">{error}</Alert> : null}
      <fieldset className="flex items-center gap-1">
        <legend className="mb-1 text-sm font-medium">Your rating</legend>
        {[1, 2, 3, 4, 5].map((stars) => (
          <button
            key={stars}
            type="button"
            aria-label={`${stars} star${stars === 1 ? "" : "s"}`}
            aria-pressed={rating === stars}
            className={`text-2xl leading-none ${stars <= rating ? "text-amber-500" : "text-muted-foreground/40"}`}
            onClick={() => setRating(stars)}
          >
            ★
          </button>
        ))}
      </fieldset>
      <div className="flex flex-col gap-2">
        <Label htmlFor={`review-title-${orderItemId}`}>Headline (optional)</Label>
        <Input id={`review-title-${orderItemId}`} maxLength={120} value={title} onChange={(event) => setTitle(event.currentTarget.value)} />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor={`review-body-${orderItemId}`}>Your review</Label>
        <Textarea id={`review-body-${orderItemId}`} rows={4} maxLength={3000} value={body} onChange={(event) => setBody(event.currentTarget.value)} />
      </div>
      <div className="flex gap-2">
        <Button
          size="sm"
          disabled={pending || rating === 0}
          onClick={() =>
            startTransition(async () => {
              setError(null);
              const result = await submitReviewAction(orderId, orderItemId, { rating, title, body });
              if (!result.ok) setError(result.message);
              else {
                setOpen(false);
                router.refresh();
              }
            })
          }
        >
          {pending ? "Saving…" : "Post review"}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
