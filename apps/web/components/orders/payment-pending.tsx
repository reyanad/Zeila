"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

/** After returning from payment, refresh until the webhook marks the order paid (up to ~1 minute). */
export function PaymentPending() {
  const router = useRouter();
  const [attempts, setAttempts] = useState(0);
  useEffect(() => {
    if (attempts >= 20) return;
    const timer = window.setTimeout(() => {
      setAttempts((count) => count + 1);
      router.refresh();
    }, 3_000);
    return () => window.clearTimeout(timer);
  }, [attempts, router]);
  return (
    <p role="status" aria-live="polite" className="text-sm">
      {attempts < 20 ? "Confirming your payment with the bank…" : "Still waiting for confirmation. You will get an email as soon as it arrives."}
    </p>
  );
}
