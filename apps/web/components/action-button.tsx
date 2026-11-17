"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button, type ButtonProps } from "@marketplace/ui";

export interface ActionButtonProps {
  /** A server action with its arguments already bound. */
  action: () => Promise<{ ok: boolean; message?: string }>;
  label: string;
  pendingLabel?: string;
  /** When set, the button asks for confirmation with this text first. */
  confirm?: string;
  variant?: ButtonProps["variant"];
  size?: ButtonProps["size"];
}

/** Runs a server action, shows its error inline and refreshes the page on success. */
export function ActionButton({ action, label, pendingLabel = "Working…", confirm, variant = "default", size = "sm" }: ActionButtonProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [asking, setAsking] = useState(false);

  const run = () =>
    startTransition(async () => {
      setMessage(null);
      const result = await action();
      setAsking(false);
      if (!result.ok) setMessage({ ok: false, text: result.message ?? "That did not work." });
      else {
        if (result.message) setMessage({ ok: true, text: result.message });
        router.refresh();
      }
    });

  return (
    <div className="flex flex-col gap-1">
      {asking ? (
        <div className="flex flex-col gap-2 rounded-md border border-border p-3 text-sm">
          <p>{confirm}</p>
          <div className="flex gap-2">
            <Button size="sm" variant={variant} disabled={pending} onClick={run}>
              {pending ? pendingLabel : "Yes, continue"}
            </Button>
            <Button size="sm" variant="ghost" disabled={pending} onClick={() => setAsking(false)}>
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <Button size={size} variant={variant} disabled={pending} aria-busy={pending} onClick={() => (confirm ? setAsking(true) : run())}>
          {pending ? pendingLabel : label}
        </Button>
      )}
      {message ? (
        <p role={message.ok ? "status" : "alert"} className={message.ok ? "text-xs" : "text-xs font-medium text-destructive"}>
          {message.text}
        </p>
      ) : null}
    </div>
  );
}
