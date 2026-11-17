"use client";

import { useActionState } from "react";
import { CARRIERS } from "@marketplace/shared-types";
import { Field } from "@/components/form/field";
import { FormMessage } from "@/components/form/form-message";
import { SelectField } from "@/components/form/select-field";
import { SubmitButton } from "@/components/form/submit-button";
import { shipAction } from "@/lib/actions/fulfilment";
import { IDLE_FORM_STATE } from "@/lib/form-state";

const OPTIONS = Object.entries(CARRIERS).map(([value, carrier]) => ({ value, label: carrier.name }));

export function ShipForm({ subOrderId }: { subOrderId: string }) {
  const [state, action] = useActionState(shipAction, IDLE_FORM_STATE);
  if (state.status === "success") return <FormMessage state={state} />;
  return (
    <form action={action} className="flex flex-col gap-3" noValidate>
      <input type="hidden" name="subOrderId" value={subOrderId} />
      <FormMessage state={state} />
      <div className="grid gap-3 sm:grid-cols-2">
        <SelectField name="carrier" label="Carrier" options={OPTIONS} defaultValue="ethiopost" />
        <Field name="trackingNumber" label="Tracking number" hint="Not needed for your own delivery." />
      </div>
      <div>
        <SubmitButton pendingLabel="Saving…">Mark as shipped</SubmitButton>
      </div>
    </form>
  );
}
