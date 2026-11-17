"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Alert, Button, Input, Label, Select, Textarea } from "@marketplace/ui";
import { sendOfferAction, type OfferFormValues } from "@/lib/actions/messaging";

export function OfferComposer({ conversationId, services, currency }: { conversationId: string; services: Array<{ id: string; title: string }>; currency: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [values, setValues] = useState<OfferFormValues>({ listingId: services[0]?.id ?? "", title: "", description: "", price: "", deliveryDays: "7", revisions: "1", validDays: "7" });
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const set = (key: keyof OfferFormValues) => (event: { currentTarget: { value: string } }) => setValues((current) => ({ ...current, [key]: event.currentTarget.value }));

  if (services.length === 0) return <p className="text-xs text-muted-foreground">Publish a service listing to send custom offers.</p>;
  if (!open) {
    return (
      <div>
        <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
          Create a custom offer
        </Button>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border p-4">
      <h2 className="font-medium">Custom offer</h2>
      {error ? <Alert tone="danger">{error}</Alert> : null}
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-2">
          <Label htmlFor="offer-listing">Service</Label>
          <Select id="offer-listing" value={values.listingId} onChange={set("listingId")}>
            {services.map((service) => (
              <option key={service.id} value={service.id}>
                {service.title}
              </option>
            ))}
          </Select>
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="offer-title">Title</Label>
          <Input id="offer-title" maxLength={120} value={values.title} onChange={set("title")} placeholder="Logo with 3 concepts" />
        </div>
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="offer-description">What is included</Label>
        <Textarea id="offer-description" rows={3} maxLength={2000} value={values.description} onChange={set("description")} />
      </div>
      <div className="grid gap-3 sm:grid-cols-4">
        <div className="flex flex-col gap-2">
          <Label htmlFor="offer-price">Price ({currency})</Label>
          <Input id="offer-price" inputMode="decimal" value={values.price} onChange={set("price")} />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="offer-days">Delivery days</Label>
          <Input id="offer-days" type="number" min={1} max={365} value={values.deliveryDays} onChange={set("deliveryDays")} />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="offer-revisions">Revisions (−1 = unlimited)</Label>
          <Input id="offer-revisions" type="number" min={-1} max={20} value={values.revisions} onChange={set("revisions")} />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="offer-valid">Valid for (days)</Label>
          <Input id="offer-valid" type="number" min={1} max={30} value={values.validDays} onChange={set("validDays")} />
        </div>
      </div>
      <div className="flex gap-2">
        <Button
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              setError(null);
              const result = await sendOfferAction(conversationId, values);
              if (!result.ok) setError(result.message);
              else {
                setOpen(false);
                setValues((current) => ({ ...current, title: "", description: "", price: "" }));
                router.refresh();
              }
            })
          }
        >
          {pending ? "Sending…" : "Send offer"}
        </Button>
        <Button variant="ghost" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
