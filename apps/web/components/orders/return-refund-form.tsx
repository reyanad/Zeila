"use client";

import { useActionState } from "react";
import { Field } from "@/components/form/field";
import { FormMessage } from "@/components/form/form-message";
import { SubmitButton } from "@/components/form/submit-button";
import { completeReturnAction } from "@/lib/actions/fulfilment";
import { IDLE_FORM_STATE } from "@/lib/form-state";

export function ReturnRefundForm({ subOrderId, rmaId, suggested, currency }: { subOrderId: string; rmaId: string; suggested: string; currency: string }) {
  const [state, action] = useActionState(completeReturnAction, IDLE_FORM_STATE);
  if (state.status === "success") return <FormMessage state={state} />;
  return (
    <form action={action} className="flex flex-col gap-3" noValidate>
      <input type="hidden" name="subOrderId" value={subOrderId} />
      <input type="hidden" name="rmaId" value={rmaId} />
      <FormMessage state={state} />
      <Field name="refund" label={`Refund (${currency})`} inputMode="decimal" defaultValue={suggested} error={state.fields?.refund} />
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="restock" defaultChecked className="h-4 w-4" />
        Put the returned items back in stock
      </label>
      <div>
        <SubmitButton pendingLabel="Refunding…">Refund buyer</SubmitButton>
      </div>
    </form>
  );
}
