"use client";

import { useActionState } from "react";
import { Field } from "@/components/form/field";
import { FormMessage } from "@/components/form/form-message";
import { SelectField, type SelectOption } from "@/components/form/select-field";
import { SubmitButton } from "@/components/form/submit-button";
import { createWarehouseAction } from "@/lib/actions/studio";
import { IDLE_FORM_STATE } from "@/lib/form-state";

export function WarehouseForm({ countries, defaultCountry }: { countries: readonly SelectOption[]; defaultCountry: string }) {
  const [state, action] = useActionState(createWarehouseAction, IDLE_FORM_STATE);
  const value = (name: string) => state.values?.[name];
  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      <FormMessage state={state} />
      <Field name="name" label="Name" placeholder="Main warehouse" required defaultValue={value("name")} error={state.fields?.name} />
      <Field name="line1" label="Street address" required defaultValue={value("line1")} error={state.fields?.line1} />
      <Field name="line2" label="Building, floor (optional)" defaultValue={value("line2")} error={state.fields?.line2} />
      <div className="grid gap-4 sm:grid-cols-3">
        <Field name="city" label="City" required defaultValue={value("city")} error={state.fields?.city} />
        <Field name="state" label="Region (optional)" defaultValue={value("state")} error={state.fields?.state} />
        <Field name="postalCode" label="Postal code (optional)" defaultValue={value("postalCode")} error={state.fields?.postalCode} />
      </div>
      <SelectField name="country" label="Country" options={countries} required defaultValue={value("country") ?? defaultCountry} error={state.fields?.country} />
      <div>
        <SubmitButton pendingLabel="Adding…">Add warehouse</SubmitButton>
      </div>
    </form>
  );
}
