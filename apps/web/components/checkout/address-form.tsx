"use client";

import { useActionState } from "react";
import { Field } from "@/components/form/field";
import { FormMessage } from "@/components/form/form-message";
import { SelectField, type SelectOption } from "@/components/form/select-field";
import { SubmitButton } from "@/components/form/submit-button";
import { saveAddressAction } from "@/lib/actions/checkout";
import { IDLE_FORM_STATE } from "@/lib/form-state";

export function AddressForm({ currency, countries, defaultCountry }: { currency: string; countries: readonly SelectOption[]; defaultCountry: string }) {
  const [state, action] = useActionState(saveAddressAction, IDLE_FORM_STATE);
  const value = (name: string) => state.values?.[name];
  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      <input type="hidden" name="currency" value={currency} />
      <FormMessage state={state} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field name="recipient" label="Full name" autoComplete="name" required defaultValue={value("recipient")} error={state.fields?.recipient} />
        <Field name="phone" label="Phone" type="tel" autoComplete="tel" required defaultValue={value("phone")} error={state.fields?.phone} hint="The courier calls this number." />
      </div>
      <Field name="line1" label="Street address or landmark" autoComplete="address-line1" required defaultValue={value("line1")} error={state.fields?.line1} />
      <Field name="line2" label="House number, building, floor (optional)" autoComplete="address-line2" defaultValue={value("line2")} error={state.fields?.line2} />
      <div className="grid gap-4 sm:grid-cols-3">
        <Field name="city" label="City" autoComplete="address-level2" required defaultValue={value("city")} error={state.fields?.city} />
        <Field name="state" label="Region or sub-city (optional)" autoComplete="address-level1" defaultValue={value("state")} error={state.fields?.state} />
        <Field name="postalCode" label="Postal code (optional)" autoComplete="postal-code" defaultValue={value("postalCode")} error={state.fields?.postalCode} />
      </div>
      <SelectField name="country" label="Country" options={countries} required defaultValue={value("country") ?? defaultCountry} error={state.fields?.country} />
      <div>
        <SubmitButton pendingLabel="Saving…">Deliver here</SubmitButton>
      </div>
    </form>
  );
}
