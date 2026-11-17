"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Alert, Button, Input, Label, Select } from "@marketplace/ui";
import { createPromoAction, type PromoFormValues } from "@/lib/actions/growth";

export function PromoForm({ currency }: { currency: string }) {
  const router = useRouter();
  const empty: PromoFormValues = { code: "", type: "PERCENT", value: "10", minSubtotal: "", usageLimit: "", perUserLimit: "1", startsAt: "", expiresAt: "" };
  const [values, setValues] = useState<PromoFormValues>(empty);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [pending, startTransition] = useTransition();
  const set = (key: keyof PromoFormValues) => (event: { currentTarget: { value: string } }) => setValues((current) => ({ ...current, [key]: event.currentTarget.value }));

  return (
    <div className="flex flex-col gap-4 rounded-lg border border-border p-4">
      <h2 className="font-medium">New coupon code</h2>
      {result ? <Alert tone={result.ok ? "success" : "danger"}>{result.message}</Alert> : null}
      <div className="grid gap-3 sm:grid-cols-4">
        <div className="flex flex-col gap-2">
          <Label htmlFor="promo-code">Code</Label>
          <Input id="promo-code" maxLength={32} value={values.code} onChange={set("code")} placeholder="WELCOME10" className="uppercase" />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="promo-type">Type</Label>
          <Select id="promo-type" value={values.type} onChange={(event) => setValues((current) => ({ ...current, type: event.currentTarget.value === "FIXED" ? "FIXED" : "PERCENT" }))}>
            <option value="PERCENT">Percent off</option>
            <option value="FIXED">Amount off ({currency})</option>
          </Select>
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="promo-value">{values.type === "PERCENT" ? "Percent" : `Amount (${currency})`}</Label>
          <Input id="promo-value" inputMode="decimal" value={values.value} onChange={set("value")} />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="promo-min">Minimum order ({currency})</Label>
          <Input id="promo-min" inputMode="decimal" value={values.minSubtotal} onChange={set("minSubtotal")} placeholder="None" />
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-4">
        <div className="flex flex-col gap-2">
          <Label htmlFor="promo-limit">Total uses</Label>
          <Input id="promo-limit" inputMode="numeric" value={values.usageLimit} onChange={set("usageLimit")} placeholder="No limit" />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="promo-per-user">Uses per buyer</Label>
          <Input id="promo-per-user" inputMode="numeric" value={values.perUserLimit} onChange={set("perUserLimit")} />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="promo-start">Starts (optional)</Label>
          <Input id="promo-start" type="datetime-local" value={values.startsAt} onChange={set("startsAt")} />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="promo-end">Expires (optional)</Label>
          <Input id="promo-end" type="datetime-local" value={values.expiresAt} onChange={set("expiresAt")} />
        </div>
      </div>
      <p className="text-xs text-muted-foreground">Your store pays for its own codes: the platform fee is charged on the discounted amount.</p>
      <div>
        <Button
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              setResult(null);
              const response = await createPromoAction({
                ...values,
                startsAt: values.startsAt ? new Date(values.startsAt).toISOString() : "",
                expiresAt: values.expiresAt ? new Date(values.expiresAt).toISOString() : "",
              });
              setResult(response.ok ? { ok: true, message: response.message ?? "Saved." } : { ok: false, message: response.message });
              if (response.ok) {
                setValues(empty);
                router.refresh();
              }
            })
          }
        >
          {pending ? "Saving…" : "Create code"}
        </Button>
      </div>
    </div>
  );
}
