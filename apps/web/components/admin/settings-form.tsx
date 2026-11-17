"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Alert, Button, Input, Label, Select, Textarea } from "@marketplace/ui";
import { saveSettingsAction, type SettingsValues } from "@/lib/actions/admin";

export function SettingsForm({ initial }: { initial: SettingsValues }) {
  const router = useRouter();
  const [values, setValues] = useState(initial);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [pending, startTransition] = useTransition();
  const set = (key: keyof SettingsValues) => (event: { currentTarget: { value: string } }) => setValues((current) => ({ ...current, [key]: event.currentTarget.value }));
  return (
    <div className="flex flex-col gap-5">
      {result ? <Alert tone={result.ok ? "success" : "danger"}>{result.message}</Alert> : null}
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="flex flex-col gap-2">
          <Label htmlFor="fee">Platform fee (%)</Label>
          <Input id="fee" inputMode="decimal" value={values.feePercent} onChange={set("feePercent")} />
          <p className="text-xs text-muted-foreground">Charged on each sale; stores can have their own rate.</p>
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="hold">Protection window (days)</Label>
          <Input id="hold" inputMode="numeric" value={values.holdDays} onChange={set("holdDays")} />
          <p className="text-xs text-muted-foreground">Days after delivery before escrow pays the seller.</p>
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="review">Listing review</Label>
          <Select id="review" value={values.reviewMode} onChange={set("reviewMode")}>
            <option value="post">After publishing (listings go live at once)</option>
            <option value="pre">Before publishing (moderators approve first)</option>
          </Select>
        </div>
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="tax">Tax rates by destination country (JSON)</Label>
        <Textarea id="tax" rows={10} className="font-mono text-xs" value={values.taxRates} onChange={set("taxRates")} />
        <p className="text-xs text-muted-foreground">
          {'Example: {"ET": {"bps": 1500, "physical": true, "digital": true, "service": true, "shippingTaxable": true, "label": "VAT"}}. Countries not listed are not taxed.'}
        </p>
      </div>
      <div>
        <Button
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              const response = await saveSettingsAction(values);
              setResult({ ok: response.ok, message: response.message ?? (response.ok ? "Saved." : "Could not save.") });
              if (response.ok) router.refresh();
            })
          }
        >
          {pending ? "Saving…" : "Save settings"}
        </Button>
      </div>
    </div>
  );
}
