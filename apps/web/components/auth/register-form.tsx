"use client";

import { useActionState } from "react";
import { PASSWORD_MIN_LENGTH } from "@marketplace/shared-types";
import { Field } from "@/components/form/field";
import { FormMessage } from "@/components/form/form-message";
import { SubmitButton } from "@/components/form/submit-button";
import { registerAction } from "@/lib/actions/auth";
import { IDLE_FORM_STATE } from "@/lib/form-state";

export function RegisterForm() {
  const [state, action] = useActionState(registerAction, IDLE_FORM_STATE);
  if (state.status === "success") return <FormMessage state={state} />;

  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      <FormMessage state={state} />
      <Field name="name" label="Full name" autoComplete="name" required error={state.fields?.name} />
      <Field name="email" label="Email" type="email" autoComplete="email" required error={state.fields?.email} />
      <Field
        name="password"
        label="Password"
        type="password"
        autoComplete="new-password"
        required
        minLength={PASSWORD_MIN_LENGTH}
        error={state.fields?.password}
        hint={`At least ${PASSWORD_MIN_LENGTH} characters. A short sentence works well.`}
      />
      <SubmitButton pendingLabel="Creating account…">Create account</SubmitButton>
    </form>
  );
}
