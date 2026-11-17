"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button, Input } from "@marketplace/ui";
import { returnTrackingAction } from "@/lib/actions/fulfilment";

export function ReturnTrackingForm({ orderId, rmaId }: { orderId: string; rmaId: string }) {
  const router = useRouter();
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  return (
    <div className="flex flex-col gap-1">
      <div className="flex gap-2">
        <Input aria-label="Return tracking number" placeholder="Tracking number of your return parcel" value={value} maxLength={60} onChange={(event) => setValue(event.currentTarget.value)} />
        <Button
          size="sm"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              const result = await returnTrackingAction(orderId, rmaId, value);
              if (!result.ok) setError(result.message);
              else router.refresh();
            })
          }
        >
          Send
        </Button>
      </div>
      {error ? <p className="text-xs font-medium text-destructive">{error}</p> : null}
    </div>
  );
}
