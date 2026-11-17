"use client";

import { useActionState } from "react";
import { FormMessage } from "@/components/form/form-message";
import { SelectField, type SelectOption } from "@/components/form/select-field";
import { SubmitButton } from "@/components/form/submit-button";
import { saveBillingCountryAction } from "@/lib/actions/checkout";
import { IDLE_FORM_STATE } from "@/lib/form-state";

export function BillingCountryForm({ currency, countries }: { currency: string; countries: readonly SelectOption[] }) {
  const [state, action] = useActionState(saveBillingCountryAction, IDLE_FORM_STATE);
  return (
    <form action={action} className="flex flex-col gap-3" noValidate>
      <input type="hidden" name="currency" value={currency} />
      <FormMessage state={state} />
      <SelectField name="country" label="Your country" options={countries} placeholder="Choose…" required error={state.fields?.country} hint="Needed to apply the right tax." />
      <div>
        <SubmitButton pendingLabel="Saving…">Continue</SubmitButton>
      </div>
    </form>
  );
}
