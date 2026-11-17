"use client";

import { useMemo, useState } from "react";
import { Elements, PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js";
import { loadStripe } from "@stripe/stripe-js";
import { Alert, Button } from "@marketplace/ui";

function PayButton({ returnUrl, label }: { returnUrl: string; label: string }) {
  const stripe = useStripe();
  const elements = useElements();
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={async (event) => {
        event.preventDefault();
        if (!stripe || !elements) return;
        setSubmitting(true);
        setError(null);
        // Redirects to returnUrl on success (or to the bank for 3-D Secure);
        // it only returns here with an error.
        const result = await stripe.confirmPayment({ elements, confirmParams: { return_url: returnUrl } });
        setError(result.error.message ?? "Your payment was not completed.");
        setSubmitting(false);
      }}
    >
      <PaymentElement options={{ layout: "tabs" }} />
      {error ? <Alert tone="danger">{error}</Alert> : null}
      <Button type="submit" size="lg" disabled={!stripe || !elements || submitting} aria-busy={submitting}>
        {submitting ? "Processing…" : label}
      </Button>
    </form>
  );
}

export function PaymentForm({ publishableKey, clientSecret, returnUrl, label }: { publishableKey: string; clientSecret: string; returnUrl: string; label: string }) {
  const stripePromise = useMemo(() => loadStripe(publishableKey), [publishableKey]);
  return (
    <Elements stripe={stripePromise} options={{ clientSecret, appearance: { theme: "stripe" } }}>
      <PayButton returnUrl={returnUrl} label={label} />
    </Elements>
  );
}
