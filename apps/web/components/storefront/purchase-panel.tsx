"use client";

import { useMemo, useState, type ReactNode } from "react";
import { convertMinor, formatMoney, type CurrencyCode, type FxRates } from "@marketplace/shared-types";
import { Badge, Button, cn, Input, Label } from "@marketplace/ui";

export interface PanelSku {
  id: string;
  variantValues: Record<string, string>;
  price: number;
  compareAtPrice: number | null;
  available: number;
  wholesale: Array<{ minQty: number; unitPrice: number }>;
}

export interface PanelTier {
  id: string;
  level: "BASIC" | "STANDARD" | "PREMIUM";
  title: string;
  description: string;
  price: number;
  deliveryDays: number;
  revisions: number;
  features: string[];
}

export type PurchaseData =
  | { type: "PHYSICAL"; currency: string; axes: Array<{ name: string; values: string[] }>; skus: PanelSku[]; shipsFrom: string | null }
  | {
      type: "DIGITAL";
      currency: string;
      price: number;
      fileName: string;
      sizeLabel: string;
      version: string;
      licensed: boolean;
      activationsLimit: number;
      downloadLimit: number | null;
    }
  | { type: "SERVICE"; currency: string; tiers: PanelTier[] };

/** What the buyer picked; Phase 5's cart consumes it. */
export interface PurchaseSelection {
  skuId?: string;
  serviceTierId?: string;
  quantity: number;
  unitPrice: number;
}

function money(amount: number, currency: string): string {
  return formatMoney({ amount, currency: currency as CurrencyCode });
}

function Approx({ amount, currency, viewerCurrency, fx }: { amount: number; currency: string; viewerCurrency: string; fx: FxRates | null }) {
  const converted = currency !== viewerCurrency ? convertMinor(amount, currency, viewerCurrency, fx) : null;
  if (converted === null) return null;
  return <span className="text-sm text-muted-foreground">≈ {money(converted, viewerCurrency)}</span>;
}

/** Unit price for a quantity after the best wholesale tier that applies. */
export function unitPriceFor(sku: PanelSku, quantity: number): number {
  const tier = [...sku.wholesale].reverse().find((candidate) => quantity >= candidate.minQty);
  return tier ? tier.unitPrice : sku.price;
}

const LEVEL_LABEL = { BASIC: "Basic", STANDARD: "Standard", PREMIUM: "Premium" } as const;

export function PurchasePanel({
  data,
  viewerCurrency,
  fx,
  renderAction,
}: {
  data: PurchaseData;
  viewerCurrency: string;
  fx: FxRates | null;
  /** Purchase controls for the current selection (null when nothing can be bought). */
  renderAction?: (selection: PurchaseSelection | null) => ReactNode;
}) {
  switch (data.type) {
    case "PHYSICAL":
      return <PhysicalPanel data={data} viewerCurrency={viewerCurrency} fx={fx} renderAction={renderAction} />;
    case "DIGITAL":
      return (
        <div className="flex flex-col gap-4">
          <div className="flex flex-col">
            <span className="text-3xl font-semibold tabular-nums">{data.price === 0 ? "Free" : money(data.price, data.currency)}</span>
            <Approx amount={data.price} currency={data.currency} viewerCurrency={viewerCurrency} fx={fx} />
          </div>
          <dl className="grid grid-cols-2 gap-2 text-sm">
            <dt className="text-muted-foreground">File</dt>
            <dd className="truncate" title={data.fileName}>
              {data.fileName} ({data.sizeLabel})
            </dd>
            <dt className="text-muted-foreground">Version</dt>
            <dd>{data.version}</dd>
            <dt className="text-muted-foreground">Licence key</dt>
            <dd>{data.licensed ? `Included, ${data.activationsLimit} device${data.activationsLimit === 1 ? "" : "s"}` : "Not needed"}</dd>
            <dt className="text-muted-foreground">Downloads</dt>
            <dd>{data.downloadLimit === null ? "Unlimited" : data.downloadLimit}</dd>
          </dl>
          <p className="text-xs text-muted-foreground">Delivered instantly after payment through a secure, time-limited link.</p>
          {renderAction?.({ quantity: 1, unitPrice: data.price })}
        </div>
      );
    case "SERVICE":
      return <ServicePanel data={data} viewerCurrency={viewerCurrency} fx={fx} renderAction={renderAction} />;
  }
}

function PhysicalPanel({
  data,
  viewerCurrency,
  fx,
  renderAction,
}: {
  data: Extract<PurchaseData, { type: "PHYSICAL" }>;
  viewerCurrency: string;
  fx: FxRates | null;
  renderAction?: (selection: PurchaseSelection | null) => ReactNode;
}) {
  const initial = data.skus.find((sku) => sku.available > 0) ?? data.skus[0];
  const [chosen, setChosen] = useState<Record<string, string>>(initial?.variantValues ?? {});
  const [quantityText, setQuantityText] = useState("1");

  const sku = useMemo(
    () => data.skus.find((candidate) => data.axes.every((axis) => candidate.variantValues[axis.name] === chosen[axis.name])),
    [chosen, data.axes, data.skus],
  );
  const quantity = Math.max(1, Math.min(Number.parseInt(quantityText, 10) || 1, sku?.available || 1));
  const unitPrice = sku ? unitPriceFor(sku, quantity) : 0;

  const availableWith = (axisName: string, value: string) =>
    data.skus.some(
      (candidate) =>
        candidate.variantValues[axisName] === value &&
        candidate.available > 0 &&
        data.axes.every((axis) => axis.name === axisName || candidate.variantValues[axis.name] === chosen[axis.name]),
    );

  return (
    <div className="flex flex-col gap-5">
      {sku ? (
        <div className="flex flex-col">
          <div className="flex items-baseline gap-3">
            <span className="text-3xl font-semibold tabular-nums">{money(unitPrice, data.currency)}</span>
            {sku.compareAtPrice !== null && unitPrice === sku.price ? (
              <span className="text-lg text-muted-foreground line-through tabular-nums">{money(sku.compareAtPrice, data.currency)}</span>
            ) : null}
            {unitPrice < sku.price ? <Badge tone="success">Wholesale price</Badge> : null}
          </div>
          <Approx amount={unitPrice} currency={data.currency} viewerCurrency={viewerCurrency} fx={fx} />
        </div>
      ) : (
        <p className="text-sm font-medium text-destructive">This combination is not available.</p>
      )}

      {data.axes.map((axis) => (
        <fieldset key={axis.name} className="flex flex-col gap-2">
          <legend className="mb-2 text-sm font-medium">
            {axis.name}: <span className="font-normal text-muted-foreground">{chosen[axis.name] ?? "Choose"}</span>
          </legend>
          <div className="flex flex-wrap gap-2">
            {axis.values.map((value) => {
              const selected = chosen[axis.name] === value;
              const available = availableWith(axis.name, value);
              return (
                <Button
                  key={value}
                  size="sm"
                  variant={selected ? "default" : "outline"}
                  aria-pressed={selected}
                  className={cn(!available && !selected && "text-muted-foreground line-through")}
                  onClick={() => setChosen((current) => ({ ...current, [axis.name]: value }))}
                >
                  {value}
                </Button>
              );
            })}
          </div>
        </fieldset>
      ))}

      {sku ? (
        <div className="flex flex-col gap-2">
          <Label htmlFor="quantity">Quantity</Label>
          <div className="flex items-center gap-3">
            <Input
              id="quantity"
              inputMode="numeric"
              className="w-24"
              value={quantityText}
              onChange={(event) => setQuantityText(event.currentTarget.value.replace(/[^\d]/g, "").slice(0, 6))}
              disabled={sku.available === 0}
            />
            <span className={cn("text-sm", sku.available === 0 ? "font-medium text-destructive" : "text-muted-foreground")}>
              {sku.available === 0 ? "Out of stock" : sku.available <= 5 ? `Only ${sku.available} left` : "In stock"}
            </span>
          </div>
        </div>
      ) : null}

      {sku && sku.wholesale.length > 0 ? (
        <table className="w-full text-sm">
          <caption className="mb-1 text-left text-sm font-medium">Buy more, pay less</caption>
          <tbody>
            <tr className="border-t border-border">
              <td className="py-1">1+</td>
              <td className="py-1 text-right tabular-nums">{money(sku.price, data.currency)} each</td>
            </tr>
            {sku.wholesale.map((tier) => (
              <tr key={tier.minQty} className="border-t border-border">
                <td className="py-1">{tier.minQty}+</td>
                <td className="py-1 text-right tabular-nums">{money(tier.unitPrice, data.currency)} each</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}

      {data.shipsFrom ? <p className="text-xs text-muted-foreground">Ships from {data.shipsFrom}</p> : null}
      {renderAction?.(sku && sku.available > 0 ? { skuId: sku.id, quantity, unitPrice } : null)}
    </div>
  );
}

function ServicePanel({
  data,
  viewerCurrency,
  fx,
  renderAction,
}: {
  data: Extract<PurchaseData, { type: "SERVICE" }>;
  viewerCurrency: string;
  fx: FxRates | null;
  renderAction?: (selection: PurchaseSelection | null) => ReactNode;
}) {
  const [activeId, setActiveId] = useState(data.tiers[0]?.id ?? "");
  const tier = data.tiers.find((candidate) => candidate.id === activeId) ?? data.tiers[0];
  if (!tier) return <p className="text-sm text-muted-foreground">This service has no packages yet.</p>;

  return (
    <div className="flex flex-col gap-4">
      {data.tiers.length > 1 ? (
        <div role="tablist" aria-label="Packages" className="grid grid-cols-3 rounded-md border border-border p-1">
          {data.tiers.map((candidate) => (
            <button
              key={candidate.id}
              type="button"
              role="tab"
              aria-selected={candidate.id === tier.id}
              onClick={() => setActiveId(candidate.id)}
              className={cn(
                "rounded px-2 py-1.5 text-sm font-medium transition-colors",
                candidate.id === tier.id ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent",
              )}
            >
              {LEVEL_LABEL[candidate.level]}
            </button>
          ))}
        </div>
      ) : null}
      <div role="tabpanel" className="flex flex-col gap-3">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="text-lg font-semibold">{tier.title}</h2>
          <div className="flex flex-col items-end">
            <span className="text-2xl font-semibold tabular-nums">{money(tier.price, data.currency)}</span>
            <Approx amount={tier.price} currency={data.currency} viewerCurrency={viewerCurrency} fx={fx} />
          </div>
        </div>
        <p className="text-sm">{tier.description}</p>
        <p className="text-sm text-muted-foreground">
          {tier.deliveryDays}-day delivery · {tier.revisions < 0 ? "Unlimited revisions" : `${tier.revisions} revision${tier.revisions === 1 ? "" : "s"}`}
        </p>
        {tier.features.length > 0 ? (
          <ul className="flex flex-col gap-1 text-sm">
            {tier.features.map((feature) => (
              <li key={feature} className="flex gap-2">
                <span aria-hidden className="text-primary">✓</span>
                {feature}
              </li>
            ))}
          </ul>
        ) : null}
        <p className="text-xs text-muted-foreground">Your payment is held in escrow and released to the seller when you approve the work.</p>
        {renderAction?.({ serviceTierId: tier.id, quantity: 1, unitPrice: tier.price })}
      </div>
    </div>
  );
}
