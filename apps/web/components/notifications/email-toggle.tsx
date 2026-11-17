"use client";

import { useState, useTransition } from "react";
import { setEmailNotificationsAction } from "@/lib/actions/notifications";

export function EmailToggle({ initial }: { initial: boolean }) {
  const [enabled, setEnabled] = useState(initial);
  const [pending, startTransition] = useTransition();
  return (
    <label className="flex items-center gap-3 rounded-md border border-border p-3 text-sm">
      <input
        type="checkbox"
        className="h-4 w-4"
        checked={enabled}
        disabled={pending}
        onChange={(event) => {
          const next = event.currentTarget.checked;
          setEnabled(next);
          startTransition(async () => {
            const result = await setEmailNotificationsAction(next);
            if (!result.ok) setEnabled(!next);
          });
        }}
      />
      <span>
        E-mail me about orders, payments, disputes and unread messages
        <span className="block text-xs text-muted-foreground">Account security e-mails are always sent.</span>
      </span>
    </label>
  );
}
