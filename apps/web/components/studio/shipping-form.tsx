"use client";

import { useActionState, useState } from "react";
import type { ShippingProfile } from "@marketplace/shared-types";
import { minorToInput } from "@marketplace/shared-types";
import { Field } from "@/components/form/field";
import { FormMessage } from "@/components/form/form-message";
import { SubmitButton } from "@/components/form/submit-button";
import { saveShippingProfileAction } from "@/lib/actions/shipping";
import { IDLE_FORM_STATE } from "@/lib/form-state";

export function ShippingForm({ profile, currency }: { profile: ShippingProfile | null; currency: string }) {
  const [state, action] = useActionState(saveShippingProfileAction, IDLE_FORM_STATE);
  const [abroad, setAbroad] = useState(profile?.international !== null && profile !== null);
  const initial = (name: string, fallback: string) => state.values?.[name] ?? fallback;
  const money = (value: number | null | undefined) => (value === null || value === undefined ? "" : minorToInput(value));

  return (
    <form action={action} className="flex flex-col gap-5" noValidate>
      <FormMessage state={state} />
      <fieldset className="grid gap-4 sm:grid-cols-2">
        <legend className="mb-2 text-sm font-medium">Within your country ({currency})</legend>
        <Field name="domesticBase" label="First kilogram" inputMode="decimal" required defaultValue={initial("domesticBase", money(profile?.domestic.base))} error={state.fields?.domesticBase} />
        <Field name="domesticPerKg" label="Each extra kilogram" inputMode="decimal" required defaultValue={initial("domesticPerKg", money(profile?.domestic.perKg ?? 0))} error={state.fields?.domesticPerKg} />
        <Field
          name="freeOverDomestic"
          label="Free shipping on orders over (optional)"
          inputMode="decimal"
          defaultValue={initial("freeOverDomestic", money(profile?.freeOverDomestic))}
          error={state.fields?.freeOverDomestic}
        />
        <Field name="handlingDays" label="Days to dispatch" inputMode="numeric" required defaultValue={initial("handlingDays", String(profile?.handlingDays ?? 2))} error={state.fields?.handlingDays} />
      </fieldset>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="shipsAbroad" className="h-4 w-4" checked={abroad} onChange={(event) => setAbroad(event.currentTarget.checked)} />
        I ship to other countries
      </label>
      {abroad ? (
        <fieldset className="grid gap-4 sm:grid-cols-2">
          <legend className="mb-2 text-sm font-medium">International ({currency})</legend>
          <Field name="internationalBase" label="First kilogram" inputMode="decimal" required defaultValue={initial("internationalBase", money(profile?.international?.base))} error={state.fields?.internationalBase} />
          <Field name="internationalPerKg" label="Each extra kilogram" inputMode="decimal" required defaultValue={initial("internationalPerKg", money(profile?.international?.perKg ?? 0))} error={state.fields?.internationalPerKg} />
        </fieldset>
      ) : null}
      <div>
        <SubmitButton pendingLabel="Saving…">Save shipping rates</SubmitButton>
      </div>
    </form>
  );
}
