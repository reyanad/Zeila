"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button, Input } from "@marketplace/ui";
import { decideReturnAction } from "@/lib/actions/fulfilment";

export function ReturnDecision({ subOrderId, rmaId }: { subOrderId: string; rmaId: string }) {
  const router = useRouter();
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const decide = (approve: boolean) =>
    startTransition(async () => {
      const result = await decideReturnAction(subOrderId, rmaId, approve, note);
      if (!result.ok) setError(result.message);
      else router.refresh();
    });
  return (
    <div className="flex flex-col gap-2">
      <Input aria-label="Note to the buyer" placeholder="Note to the buyer (return address, instructions or reason)" value={note} maxLength={1000} onChange={(event) => setNote(event.currentTarget.value)} />
      <div className="flex gap-2">
        <Button size="sm" disabled={pending} onClick={() => decide(true)}>
          Approve return
        </Button>
        <Button size="sm" variant="outline" disabled={pending || note.trim().length < 5} onClick={() => decide(false)}>
          Decline
        </Button>
      </div>
      {error ? <p className="text-xs font-medium text-destructive">{error}</p> : null}
    </div>
  );
}
