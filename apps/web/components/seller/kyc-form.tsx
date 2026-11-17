"use client";

import { useActionState } from "react";
import { KYC_DOCUMENT_CONTENT_TYPES } from "@marketplace/shared-types";
import { Field } from "@/components/form/field";
import { FormMessage } from "@/components/form/form-message";
import { SelectField, type SelectOption } from "@/components/form/select-field";
import { SubmitButton } from "@/components/form/submit-button";
import { submitKycAction } from "@/lib/actions/seller";
import { IDLE_FORM_STATE } from "@/lib/form-state";

const ID_TYPE_OPTIONS: SelectOption[] = [
  { value: "national_id", label: "National ID card" },
  { value: "passport", label: "Passport" },
  { value: "driver_license", label: "Driver's licence" },
];

const ACCEPT = KYC_DOCUMENT_CONTENT_TYPES.join(",");
const FILE_HINT = "JPEG, PNG, WebP or PDF, up to 10 MB.";

export function KycForm({ countries }: { countries: readonly SelectOption[] }) {
  const [state, action] = useActionState(submitKycAction, IDLE_FORM_STATE);
  if (state.status === "success") return <FormMessage state={state} />;

  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      <FormMessage state={state} />
      <Field
        name="legalName"
        label="Full legal name"
        autoComplete="name"
        required
        defaultValue={state.values?.legalName}
        error={state.fields?.legalName}
        hint="Exactly as it appears on your ID document."
      />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          name="birthDate"
          label="Date of birth"
          type="date"
          required
          defaultValue={state.values?.birthDate}
          error={state.fields?.birthDate}
        />
        <SelectField
          name="country"
          label="Country that issued your ID"
          options={countries}
          placeholder="Choose…"
          required
          defaultValue={state.values?.country}
          error={state.fields?.country}
        />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <SelectField
          name="idType"
          label="Document type"
          options={ID_TYPE_OPTIONS}
          placeholder="Choose…"
          required
          defaultValue={state.values?.idType}
          error={state.fields?.idType}
        />
        <Field name="idNumber" label="Document number" required autoComplete="off" error={state.fields?.idNumber} />
      </div>

      <fieldset className="flex flex-col gap-4 rounded-md border border-border p-4">
        <legend className="px-1 text-sm font-medium">Documents</legend>
        {state.fields?.documents ? <p className="text-xs font-medium text-destructive">{state.fields.documents}</p> : null}
        <Field name="id_front" label="Front of your ID" type="file" accept={ACCEPT} required error={state.fields?.id_front} hint={FILE_HINT} />
        <Field name="id_back" label="Back of your ID (if it has one)" type="file" accept={ACCEPT} error={state.fields?.id_back} />
        <Field
          name="selfie"
          label="Selfie holding your ID"
          type="file"
          accept={ACCEPT}
          required
          error={state.fields?.selfie}
          hint="Your face and the ID must both be readable."
        />
        <Field
          name="proof_of_address"
          label="Proof of address (optional)"
          type="file"
          accept={ACCEPT}
          error={state.fields?.proof_of_address}
          hint="A utility bill or bank statement from the last three months."
        />
      </fieldset>
      <p className="text-xs text-muted-foreground">
        Documents are encrypted before they are stored and are only visible to our verification team.
      </p>
      <SubmitButton pendingLabel="Uploading…">Submit for review</SubmitButton>
    </form>
  );
}
