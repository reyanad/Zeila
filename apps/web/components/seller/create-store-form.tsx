"use client";

import { useActionState, useState } from "react";
import { SUPPORTED_CURRENCIES } from "@marketplace/shared-types";
import { Field } from "@/components/form/field";
import { FormMessage } from "@/components/form/form-message";
import { SelectField, type SelectOption } from "@/components/form/select-field";
import { SubmitButton } from "@/components/form/submit-button";
import { createStoreAction } from "@/lib/actions/seller";
import { IDLE_FORM_STATE } from "@/lib/form-state";

const CURRENCY_OPTIONS: SelectOption[] = SUPPORTED_CURRENCIES.map((code) => ({ value: code, label: code }));

function suggestSlug(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

export function CreateStoreForm({ countries }: { countries: readonly SelectOption[] }) {
  const [state, action] = useActionState(createStoreAction, IDLE_FORM_STATE);
  const [slug, setSlug] = useState("");
  const [slugEdited, setSlugEdited] = useState(false);

  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      <FormMessage state={state} />
      <Field
        name="name"
        label="Store name"
        required
        maxLength={60}
        defaultValue={state.values?.name}
        error={state.fields?.name}
        onChange={(event) => {
          if (!slugEdited) setSlug(suggestSlug(event.currentTarget.value));
        }}
      />
      <Field
        name="slug"
        label="Store address"
        required
        value={slug}
        onChange={(event) => {
          setSlugEdited(true);
          setSlug(event.currentTarget.value.toLowerCase());
        }}
        error={state.fields?.slug}
        hint={`Your store will live at /store/${slug || "your-store"}`}
      />
      <div className="grid gap-4 sm:grid-cols-2">
        <SelectField
          name="country"
          label="Country"
          options={countries}
          placeholder="Choose…"
          required
          defaultValue={state.values?.country}
          error={state.fields?.country}
        />
        <SelectField
          name="currency"
          label="Currency"
          options={CURRENCY_OPTIONS}
          required
          defaultValue={state.values?.currency ?? "USD"}
          error={state.fields?.currency}
        />
      </div>
      <Field
        name="tagline"
        label="Tagline (optional)"
        maxLength={120}
        defaultValue={state.values?.tagline}
        error={state.fields?.tagline}
      />
      <SubmitButton pendingLabel="Opening store…">Open store</SubmitButton>
    </form>
  );
}
