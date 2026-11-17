"use client";

import Link from "next/link";
import { useActionState } from "react";
import { PASSWORD_MIN_LENGTH } from "@marketplace/shared-types";
import { buttonVariants } from "@marketplace/ui";
import { Field } from "@/components/form/field";
import { FormMessage } from "@/components/form/form-message";
import { SubmitButton } from "@/components/form/submit-button";
import { requestPasswordResetAction, resetPasswordAction } from "@/lib/actions/auth";
import { IDLE_FORM_STATE } from "@/lib/form-state";

export function ForgotPasswordForm() {
  const [state, action] = useActionState(requestPasswordResetAction, IDLE_FORM_STATE);
  if (state.status === "success") return <FormMessage state={state} />;

  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      <FormMessage state={state} />
      <Field name="email" label="Email" type="email" autoComplete="email" required error={state.fields?.email} />
      <SubmitButton pendingLabel="Sending…">Send reset link</SubmitButton>
    </form>
  );
}

export function ResetPasswordForm({ token }: { token: string }) {
  const [state, action] = useActionState(resetPasswordAction, IDLE_FORM_STATE);
  if (state.status === "success") {
    return (
      <div className="flex flex-col gap-4">
        <FormMessage state={state} />
        <Link href="/login" className={buttonVariants()}>
          Sign in
        </Link>
      </div>
    );
  }

  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      <FormMessage state={state} />
      <input type="hidden" name="token" value={token} />
      <Field
        name="password"
        label="New password"
        type="password"
        autoComplete="new-password"
        required
        minLength={PASSWORD_MIN_LENGTH}
        error={state.fields?.password}
        hint={`At least ${PASSWORD_MIN_LENGTH} characters.`}
      />
      <Field
        name="confirmPassword"
        label="Repeat new password"
        type="password"
        autoComplete="new-password"
        required
        error={state.fields?.confirmPassword}
      />
      <SubmitButton pendingLabel="Saving…">Change password</SubmitButton>
    </form>
  );
}
