"use client";

import { useActionState, useEffect } from "react";
import { signOut } from "next-auth/react";
import { PASSWORD_MIN_LENGTH } from "@marketplace/shared-types";
import { Field } from "@/components/form/field";
import { FormMessage } from "@/components/form/form-message";
import { SubmitButton } from "@/components/form/submit-button";
import { changePasswordAction } from "@/lib/actions/auth";
import { IDLE_FORM_STATE } from "@/lib/form-state";

export function ChangePasswordForm({ hasPassword }: { hasPassword: boolean }) {
  const [state, action] = useActionState(changePasswordAction, IDLE_FORM_STATE);

  // Changing the password revokes every session, including this one.
  useEffect(() => {
    if (state.status !== "success") return;
    const timer = window.setTimeout(() => void signOut({ callbackUrl: "/login" }), 2500);
    return () => window.clearTimeout(timer);
  }, [state.status]);

  if (state.status === "success") return <FormMessage state={state} />;

  return (
    <form action={action} className="flex max-w-md flex-col gap-4" noValidate>
      <FormMessage state={state} />
      {hasPassword ? (
        <Field
          name="currentPassword"
          label="Current password"
          type="password"
          autoComplete="current-password"
          required
          error={state.fields?.currentPassword}
        />
      ) : null}
      <Field
        name="newPassword"
        label="New password"
        type="password"
        autoComplete="new-password"
        required
        minLength={PASSWORD_MIN_LENGTH}
        error={state.fields?.newPassword}
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
      <div>
        <SubmitButton pendingLabel="Saving…">{hasPassword ? "Change password" : "Set a password"}</SubmitButton>
      </div>
    </form>
  );
}
