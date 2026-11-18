"use client";

import { useActionState } from "react";
import { FormMessage } from "@/components/form/form-message";
import { SubmitButton } from "@/components/form/submit-button";
import { startPaymentAction } from "@/lib/actions/checkout";
import { IDLE_FORM_STATE } from "@/lib/form-state";

/** Sends the buyer to Chapa's secure checkout page. */
export function ChapaPayForm({ orderId, label }: { orderId: string; label: string }) {
  const [state, action] = useActionState(startPaymentAction.bind(null, orderId), IDLE_FORM_STATE);
  return (
    <form action={action} className="flex flex-col gap-3">
      <FormMessage state={state} />
      <SubmitButton size="lg" pendingLabel="Opening Chapa…">
        {label}
      </SubmitButton>
    </form>
  );
}
