"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button, Input } from "@marketplace/ui";
import { payAffiliateAction } from "@/lib/actions/admin";

export function AffiliatePayout({ affiliateId, currency, amountLabel }: { affiliateId: string; currency: string; amountLabel: string }) {
  const router = useRouter();
  const [reference, setReference] = useState("");
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, startTransition] = useTransition();
  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap gap-2">
        <Input aria-label="Transfer reference" placeholder="Bank or mobile money reference" value={reference} maxLength={120} onChange={(event) => setReference(event.currentTarget.value)} className="h-8 w-64" />
        <Button
          size="sm"
          variant="outline"
          disabled={pending || reference.trim().length < 4}
          onClick={() =>
            startTransition(async () => {
              const result = await payAffiliateAction(affiliateId, currency, reference);
              setMessage({ ok: result.ok, text: result.message ?? "" });
              if (result.ok) router.refresh();
            })
          }
        >
          Record {amountLabel} paid
        </Button>
      </div>
      {message?.text ? <p className={message.ok ? "text-xs" : "text-xs font-medium text-destructive"}>{message.text}</p> : null}
    </div>
  );
}
