"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Alert, Button, Label, Textarea } from "@marketplace/ui";

/**
 * Approve / reject with a note, for review queues. The note is required to
 * reject (the server enforces it too).
 */
export function DecisionForm({ approveLabel, rejectLabel, noteLabel, onDecide }: {
  approveLabel: string;
  rejectLabel: string;
  noteLabel: string;
  onDecide: (approve: boolean, note: string) => Promise<{ ok: boolean; message?: string }>;
}) {
  const router = useRouter();
  const [note, setNote] = useState("");
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [pending, startTransition] = useTransition();
  const decide = (approve: boolean) =>
    startTransition(async () => {
      const response = await onDecide(approve, note);
      setResult({ ok: response.ok, message: response.message ?? (response.ok ? "Done." : "That did not work.") });
      if (response.ok) router.refresh();
    });
  return (
    <div className="flex flex-col gap-3">
      {result ? <Alert tone={result.ok ? "success" : "danger"}>{result.message}</Alert> : null}
      <div className="flex flex-col gap-2">
        <Label htmlFor="decision-note">{noteLabel}</Label>
        <Textarea id="decision-note" rows={3} maxLength={1000} value={note} onChange={(event) => setNote(event.currentTarget.value)} />
      </div>
      <div className="flex gap-2">
        <Button disabled={pending} onClick={() => decide(true)}>
          {approveLabel}
        </Button>
        <Button variant="destructive" disabled={pending || note.trim().length < 10} onClick={() => decide(false)}>
          {rejectLabel}
        </Button>
      </div>
    </div>
  );
}
