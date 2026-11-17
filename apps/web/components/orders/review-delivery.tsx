"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Alert, Button, Label, Textarea } from "@marketplace/ui";
import { ActionButton } from "@/components/action-button";
import { approveDeliveryAction, requestRevisionAction } from "@/lib/actions/fulfilment";

export function ReviewDelivery({ orderId, orderItemId, canRevise }: { orderId: string; orderItemId: string; canRevise: boolean }) {
  const router = useRouter();
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  return (
    <div className="flex flex-col gap-4 rounded-md border border-border p-3">
      <div className="flex flex-col gap-2">
        <p className="text-sm">Happy with the work? Approving pays the seller now.</p>
        <ActionButton
          action={approveDeliveryAction.bind(null, orderId, orderItemId)}
          label="Approve and pay the seller"
          pendingLabel="Approving…"
          confirm="Approve this delivery? The seller is paid from escrow and the order is completed."
        />
      </div>
      {canRevise ? (
        <div className="flex flex-col gap-2">
          {error ? <Alert tone="danger">{error}</Alert> : null}
          <Label htmlFor={`revision-${orderItemId}`}>Or ask for changes</Label>
          <Textarea id={`revision-${orderItemId}`} rows={3} maxLength={5000} value={note} onChange={(event) => setNote(event.currentTarget.value)} />
          <div>
            <Button
              variant="outline"
              disabled={pending || note.trim().length < 10}
              onClick={() =>
                startTransition(async () => {
                  setError(null);
                  const result = await requestRevisionAction(orderId, orderItemId, note);
                  if (!result.ok) setError(result.message);
                  else {
                    setNote("");
                    router.refresh();
                  }
                })
              }
            >
              {pending ? "Sending…" : "Request changes"}
            </Button>
          </div>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">All revision rounds in this package are used. If something is wrong, open a dispute.</p>
      )}
    </div>
  );
}
