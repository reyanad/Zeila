"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button, Textarea } from "@marketplace/ui";
import { replyToReviewAction } from "@/lib/actions/growth";

export function ReviewReply({ reviewId, existing }: { reviewId: string; existing: string | null }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reply, setReply] = useState(existing ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  if (!open) {
    return (
      <Button size="sm" variant="ghost" onClick={() => setOpen(true)}>
        {existing ? "Edit reply" : "Reply publicly"}
      </Button>
    );
  }
  return (
    <div className="flex flex-col gap-2">
      <Textarea aria-label="Your public reply" rows={3} maxLength={1500} value={reply} onChange={(event) => setReply(event.currentTarget.value)} />
      {error ? <p className="text-xs font-medium text-destructive">{error}</p> : null}
      <div className="flex gap-2">
        <Button
          size="sm"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              const result = await replyToReviewAction(reviewId, reply);
              if (!result.ok) setError(result.message);
              else {
                setOpen(false);
                router.refresh();
              }
            })
          }
        >
          {pending ? "Posting…" : "Post reply"}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
