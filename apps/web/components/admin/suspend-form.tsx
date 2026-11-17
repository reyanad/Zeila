"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button, Input } from "@marketplace/ui";
import { suspendUserAction } from "@/lib/actions/admin";

export function SuspendForm({ userId }: { userId: string }) {
  const router = useRouter();
  const [reason, setReason] = useState("");
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, startTransition] = useTransition();
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        <Input aria-label="Reason for suspension" placeholder="Reason (kept in the audit log)" value={reason} maxLength={500} onChange={(event) => setReason(event.currentTarget.value)} className="min-w-64 flex-1" />
        <Button
          size="sm"
          variant="destructive"
          disabled={pending || reason.trim().length < 10}
          onClick={() =>
            startTransition(async () => {
              const result = await suspendUserAction(userId, reason);
              setMessage({ ok: result.ok, text: result.message ?? "" });
              if (result.ok) router.refresh();
            })
          }
        >
          Suspend
        </Button>
      </div>
      {message?.text ? <p className={message.ok ? "text-xs" : "text-xs font-medium text-destructive"}>{message.text}</p> : null}
    </div>
  );
}
