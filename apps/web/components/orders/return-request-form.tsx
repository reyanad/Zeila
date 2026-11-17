"use client";

import { useActionState, useState } from "react";
import { RETURN_REASONS } from "@marketplace/shared-types";
import { Button, Label, Textarea } from "@marketplace/ui";
import { Field } from "@/components/form/field";
import { FormMessage } from "@/components/form/form-message";
import { SelectField } from "@/components/form/select-field";
import { SubmitButton } from "@/components/form/submit-button";
import { requestReturnAction } from "@/lib/actions/fulfilment";
import { IDLE_FORM_STATE } from "@/lib/form-state";

const REASONS = Object.entries(RETURN_REASONS).map(([value, label]) => ({ value, label }));

export function ReturnRequestForm({ orderId, orderItemId, maxQuantity }: { orderId: string; orderItemId: string; maxQuantity: number }) {
  const [open, setOpen] = useState(false);
  const [state, action] = useActionState(requestReturnAction, IDLE_FORM_STATE);
  if (state.status === "success") return <FormMessage state={state} />;
  if (!open) {
    return (
      <div>
        <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
          Return or report a problem
        </Button>
      </div>
    );
  }
  return (
    <form action={action} className="flex flex-col gap-3 rounded-md border border-border p-3" noValidate>
      <input type="hidden" name="orderId" value={orderId} />
      <input type="hidden" name="orderItemId" value={orderItemId} />
      <FormMessage state={state} />
      <div className="grid gap-3 sm:grid-cols-2">
        <SelectField name="reason" label="Reason" options={REASONS} placeholder="Choose a reason" />
        {maxQuantity > 1 ? <Field name="quantity" label={`How many (of ${maxQuantity})`} type="number" min={1} max={maxQuantity} defaultValue="1" /> : <input type="hidden" name="quantity" value="1" />}
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor={`return-details-${orderItemId}`}>What happened?</Label>
        <Textarea id={`return-details-${orderItemId}`} name="details" rows={3} maxLength={2000} />
      </div>
      <p className="text-xs text-muted-foreground">The seller's payment stays on hold until the return is settled.</p>
      <div className="flex gap-2">
        <SubmitButton pendingLabel="Sending…">Request return</SubmitButton>
        <Button variant="ghost" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
