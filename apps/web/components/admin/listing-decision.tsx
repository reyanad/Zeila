"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button, Input } from "@marketplace/ui";
import { moderateListingAction } from "@/lib/actions/admin";

export function ListingDecision({ listingId, pending: isPending }: { listingId: string; pending: boolean }) {
  const router = useRouter();
  const [note, setNote] = useState("");
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, startTransition] = useTransition();
  const decide = (decision: "approve" | "reject") =>
    startTransition(async () => {
      const result = await moderateListingAction(listingId, decision, note);
      setMessage({ ok: result.ok, text: result.message ?? "" });
      if (result.ok) router.refresh();
    });
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        <Input aria-label="Moderation note" placeholder={isPending ? "Note (required to reject)" : "Reason for taking it down"} value={note} maxLength={1000} onChange={(event) => setNote(event.currentTarget.value)} className="min-w-64 flex-1" />
        {isPending ? (
          <Button size="sm" disabled={busy} onClick={() => decide("approve")}>
            Approve
          </Button>
        ) : null}
        <Button size="sm" variant="destructive" disabled={busy || note.trim().length < 10} onClick={() => decide("reject")}>
          {isPending ? "Reject" : "Take down"}
        </Button>
      </div>
      {message?.text ? <p className={message.ok ? "text-xs" : "text-xs font-medium text-destructive"}>{message.text}</p> : null}
    </div>
  );
}
