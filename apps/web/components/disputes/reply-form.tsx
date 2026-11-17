"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Alert, Button, Input, Label, Textarea } from "@marketplace/ui";
import { FileUploader, type UploadedFile } from "@/components/orders/file-uploader";
import { replyToDisputeAction } from "@/lib/actions/disputes";

export function DisputeReplyForm({ disputeId, subOrderId, canPropose, currency, label = "Reply" }: { disputeId: string; subOrderId: string; canPropose: boolean; currency: string; label?: string }) {
  const router = useRouter();
  const [body, setBody] = useState("");
  const [proposal, setProposal] = useState("");
  const [files, setFiles] = useState<UploadedFile[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border p-4">
      {error ? <Alert tone="danger">{error}</Alert> : null}
      <div className="flex flex-col gap-2">
        <Label htmlFor={`reply-${disputeId}`}>{label}</Label>
        <Textarea id={`reply-${disputeId}`} rows={4} maxLength={5000} value={body} onChange={(event) => setBody(event.currentTarget.value)} />
      </div>
      <FileUploader endpoint={`/api/disputes/files?subOrderId=${encodeURIComponent(subOrderId)}`} label="Evidence (photos, screenshots, documents)" files={files} onChange={setFiles} />
      {canPropose ? (
        <div className="flex flex-col gap-2 sm:max-w-xs">
          <Label htmlFor={`proposal-${disputeId}`}>Offer a refund to settle ({currency}, optional)</Label>
          <Input id={`proposal-${disputeId}`} inputMode="decimal" value={proposal} onChange={(event) => setProposal(event.currentTarget.value)} />
        </div>
      ) : null}
      <div>
        <Button
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              setError(null);
              const result = await replyToDisputeAction(disputeId, { body, fileTokens: files.map((file) => file.token), proposal });
              if (!result.ok) setError(result.message);
              else {
                setBody("");
                setProposal("");
                setFiles([]);
                router.refresh();
              }
            })
          }
        >
          {pending ? "Sending…" : "Send"}
        </Button>
      </div>
    </div>
  );
}
