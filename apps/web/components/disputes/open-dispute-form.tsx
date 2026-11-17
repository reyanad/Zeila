"use client";

import { useState, useTransition } from "react";
import { DISPUTE_REASONS } from "@marketplace/shared-types";
import { Alert, Button, Label, Select, Textarea } from "@marketplace/ui";
import { FileUploader, type UploadedFile } from "@/components/orders/file-uploader";
import { openDisputeAction } from "@/lib/actions/disputes";

export function OpenDisputeForm({ subOrderId, items }: { subOrderId: string; items: Array<{ id: string; title: string }> }) {
  const [reason, setReason] = useState("");
  const [itemId, setItemId] = useState(items.length === 1 ? (items[0]?.id ?? "") : "");
  const [description, setDescription] = useState("");
  const [files, setFiles] = useState<UploadedFile[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  return (
    <div className="flex flex-col gap-4">
      {error ? <Alert tone="danger">{error}</Alert> : null}
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-2">
          <Label htmlFor="dispute-reason">What went wrong?</Label>
          <Select id="dispute-reason" value={reason} onChange={(event) => setReason(event.currentTarget.value)}>
            <option value="">Choose…</option>
            {Object.entries(DISPUTE_REASONS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Select>
        </div>
        {items.length > 1 ? (
          <div className="flex flex-col gap-2">
            <Label htmlFor="dispute-item">Which item?</Label>
            <Select id="dispute-item" value={itemId} onChange={(event) => setItemId(event.currentTarget.value)}>
              <option value="">The whole order</option>
              {items.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.title}
                </option>
              ))}
            </Select>
          </div>
        ) : null}
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="dispute-description">Describe the problem and what would put it right</Label>
        <Textarea id="dispute-description" rows={5} maxLength={5000} value={description} onChange={(event) => setDescription(event.currentTarget.value)} />
      </div>
      <FileUploader endpoint={`/api/disputes/files?subOrderId=${encodeURIComponent(subOrderId)}`} label="Photos or documents (optional)" files={files} onChange={setFiles} />
      <p className="text-xs text-muted-foreground">The seller's payment stays on hold while the case is open. The seller has 3 days to reply before the platform steps in.</p>
      <div>
        <Button
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              setError(null);
              const result = await openDisputeAction({ subOrderId, orderItemId: itemId, reason, description, fileTokens: files.map((file) => file.token) });
              if (result && !result.ok) setError(result.message);
            })
          }
        >
          {pending ? "Opening…" : "Open case"}
        </Button>
      </div>
    </div>
  );
}
