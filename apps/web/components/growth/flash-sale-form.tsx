"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Alert, Button, Input, Label } from "@marketplace/ui";
import { createFlashSaleAction } from "@/lib/actions/growth";

function localInput(date: Date): string {
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

export function FlashSaleForm({ listings }: { listings: Array<{ id: string; title: string }> }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [percent, setPercent] = useState("20");
  const [startsAt, setStartsAt] = useState(() => localInput(new Date()));
  const [endsAt, setEndsAt] = useState(() => localInput(new Date(Date.now() + 24 * 3_600_000)));
  const [selected, setSelected] = useState<Record<string, string | null>>({});
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [pending, startTransition] = useTransition();

  const toggle = (id: string) => setSelected((current) => {
    const next = { ...current };
    if (id in next) delete next[id];
    else next[id] = "";
    return next;
  });

  return (
    <div className="flex flex-col gap-4 rounded-lg border border-border p-4">
      <h2 className="font-medium">New flash sale</h2>
      {result ? <Alert tone={result.ok ? "success" : "danger"}>{result.message}</Alert> : null}
      <div className="grid gap-3 sm:grid-cols-4">
        <div className="flex flex-col gap-2 sm:col-span-2">
          <Label htmlFor="flash-name">Name</Label>
          <Input id="flash-name" maxLength={80} value={name} onChange={(event) => setName(event.currentTarget.value)} placeholder="Weekend coffee sale" />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="flash-percent">Discount (%)</Label>
          <Input id="flash-percent" inputMode="decimal" value={percent} onChange={(event) => setPercent(event.currentTarget.value)} />
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-2">
          <Label htmlFor="flash-start">Starts</Label>
          <Input id="flash-start" type="datetime-local" value={startsAt} onChange={(event) => setStartsAt(event.currentTarget.value)} />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="flash-end">Ends</Label>
          <Input id="flash-end" type="datetime-local" value={endsAt} onChange={(event) => setEndsAt(event.currentTarget.value)} />
        </div>
      </div>
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-medium">Listings (optionally limit how many units sell at the sale price)</legend>
        {listings.length === 0 ? <p className="text-sm text-muted-foreground">Publish listings first.</p> : null}
        <ul className="flex max-h-72 flex-col gap-1 overflow-y-auto">
          {listings.map((listing) => (
            <li key={listing.id} className="flex items-center gap-3 text-sm">
              <label className="flex flex-1 items-center gap-2">
                <input type="checkbox" className="h-4 w-4" checked={listing.id in selected} onChange={() => toggle(listing.id)} />
                <span className="truncate">{listing.title}</span>
              </label>
              {listing.id in selected ? (
                <Input
                  aria-label={`Units at the sale price for ${listing.title}`}
                  className="h-8 w-28"
                  inputMode="numeric"
                  placeholder="No limit"
                  value={selected[listing.id] ?? ""}
                  onChange={(event) => {
                    const value = event.currentTarget.value;
                    setSelected((current) => ({ ...current, [listing.id]: value }));
                  }}
                />
              ) : null}
            </li>
          ))}
        </ul>
      </fieldset>
      <div>
        <Button
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              setResult(null);
              const response = await createFlashSaleAction({
                name,
                percent,
                startsAt: new Date(startsAt).toISOString(),
                endsAt: new Date(endsAt).toISOString(),
                listings: Object.entries(selected).map(([listingId, cap]) => ({ listingId, cap: cap ?? "" })),
              });
              setResult(response.ok ? { ok: true, message: response.message ?? "Saved." } : { ok: false, message: response.message });
              if (response.ok) {
                setName("");
                setSelected({});
                router.refresh();
              }
            })
          }
        >
          {pending ? "Saving…" : "Schedule sale"}
        </Button>
      </div>
    </div>
  );
}
