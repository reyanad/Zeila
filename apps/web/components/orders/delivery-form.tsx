"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Alert, Button, Label, Textarea } from "@marketplace/ui";
import { submitDeliveryAction } from "@/lib/actions/fulfilment";
import { FileUploader, type UploadedFile } from "./file-uploader";

export function DeliveryForm({ subOrderId, orderItemId }: { subOrderId: string; orderItemId: string }) {
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [files, setFiles] = useState<UploadedFile[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <div className="flex flex-col gap-3">
      {error ? <Alert tone="danger">{error}</Alert> : null}
      <div className="flex flex-col gap-2">
        <Label htmlFor={`delivery-${orderItemId}`}>Message to the buyer</Label>
        <Textarea id={`delivery-${orderItemId}`} rows={4} maxLength={5000} value={message} onChange={(event) => setMessage(event.currentTarget.value)} />
      </div>
      <FileUploader orderItemId={orderItemId} label="Delivered files" files={files} onChange={setFiles} />
      <div>
        <Button
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              setError(null);
              const result = await submitDeliveryAction(subOrderId, orderItemId, message, files.map((file) => file.token));
              if (!result.ok) setError(result.message);
              else {
                setMessage("");
                setFiles([]);
                router.refresh();
              }
            })
          }
        >
          {pending ? "Delivering…" : "Deliver work"}
        </Button>
      </div>
    </div>
  );
}
