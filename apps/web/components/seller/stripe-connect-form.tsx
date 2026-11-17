"use client";

import { useActionState } from "react";
import { FormMessage } from "@/components/form/form-message";
import { SubmitButton } from "@/components/form/submit-button";
import { startStripeOnboardingAction } from "@/lib/actions/seller";
import { IDLE_FORM_STATE } from "@/lib/form-state";

/** Starts (or resumes) Stripe's hosted onboarding for the seller's payout account. */
export function StripeConnectForm({ label }: { label: string }) {
  const [state, action] = useActionState(startStripeOnboardingAction, IDLE_FORM_STATE);
  return (
    <form action={action} className="flex flex-col gap-3">
      <FormMessage state={state} />
      <div>
        <SubmitButton pendingLabel="Opening Stripe…">{label}</SubmitButton>
      </div>
    </form>
  );
}
