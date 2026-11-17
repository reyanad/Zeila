"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Alert, Button, Input, Label, Textarea } from "@marketplace/ui";
import { resolveDisputeAction, submitChargebackEvidenceAction } from "@/lib/actions/disputes";

export function ResolveDisputeForm({ disputeId, currency, maxRefund, suggested }: { disputeId: string; currency: string; maxRefund: string; suggested: string }) {
  const router = useRouter();
  const [refund, setRefund] = useState(suggested);
  const [note, setNote] = useState("");
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [pending, startTransition] = useTransition();
  return (
    <div className="flex flex-col gap-3 rounded-lg border-2 border-primary/40 p-4">
      <h2 className="font-medium">Decision</h2>
      {result ? <Alert tone={result.ok ? "success" : "danger"}>{result.message}</Alert> : null}
      <div className="flex flex-col gap-2 sm:max-w-xs">
        <Label htmlFor="resolve-refund">
          Refund to the buyer ({currency}, up to {maxRefund}; 0 for none)
        </Label>
        <Input id="resolve-refund" inputMode="decimal" value={refund} onChange={(event) => setRefund(event.currentTarget.value)} />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="resolve-note">Explanation sent to both sides</Label>
        <Textarea id="resolve-note" rows={4} maxLength={5000} value={note} onChange={(event) => setNote(event.currentTarget.value)} />
      </div>
      <p className="text-xs text-muted-foreground">Any refund is paid from escrow; the rest is released to the seller immediately.</p>
      <div>
        <Button
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              const response = await resolveDisputeAction(disputeId, { refund, note });
              setResult(response.ok ? { ok: true, message: response.message ?? "Done." } : { ok: false, message: response.message });
              if (response.ok) router.refresh();
            })
          }
        >
          {pending ? "Saving…" : "Record decision"}
        </Button>
      </div>
    </div>
  );
}

export function ChargebackEvidenceForm({ disputeId }: { disputeId: string }) {
  const router = useRouter();
  const [summary, setSummary] = useState("");
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [pending, startTransition] = useTransition();
  return (
    <div className="flex flex-col gap-3 rounded-lg border-2 border-primary/40 p-4">
      <h2 className="font-medium">Evidence for the bank</h2>
      {result ? <Alert tone={result.ok ? "success" : "danger"}>{result.message}</Alert> : null}
      <Label htmlFor="evidence-summary">Summary (delivery proof, tracking, buyer messages, terms accepted)</Label>
      <Textarea id="evidence-summary" rows={6} maxLength={20000} value={summary} onChange={(event) => setSummary(event.currentTarget.value)} />
      <p className="text-xs text-muted-foreground">Submitting sends the evidence to Stripe and cannot be edited afterwards.</p>
      <div>
        <Button
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              const response = await submitChargebackEvidenceAction(disputeId, { summary });
              setResult(response.ok ? { ok: true, message: response.message ?? "Submitted." } : { ok: false, message: response.message });
              if (response.ok) router.refresh();
            })
          }
        >
          {pending ? "Submitting…" : "Submit evidence"}
        </Button>
      </div>
    </div>
  );
}
