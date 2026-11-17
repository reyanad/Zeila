"use client";

import Link from "next/link";
import { useState } from "react";
import { discountedUnitPrice, LISTING_LIMITS, minorToInput, parseMoneyInput } from "@marketplace/shared-types";
import { Alert, Button, Input, Label } from "@marketplace/ui";
import { FieldError, TextField, useBuilder } from "./builder-context";
import { uid, type AxisDraft, type WarehouseOption } from "./builder-store";

function variantLabel(values: Record<string, string>): string {
  const parts = Object.values(values);
  return parts.length > 0 ? parts.join(" / ") : "Default";
}

export function PhysicalEditor({ warehouses, currency }: { warehouses: readonly WarehouseOption[]; currency: string }) {
  const draft = useBuilder((state) => state.draft);
  const errors = useBuilder((state) => state.errors);
  const setAxes = useBuilder((state) => state.setAxes);
  const updateSku = useBuilder((state) => state.updateSku);
  const set = useBuilder((state) => state.set);
  const [bulkPrice, setBulkPrice] = useState("");

  const editAxis = (axisUid: string, patch: Partial<AxisDraft>) =>
    setAxes(draft.axes.map((axis) => (axis.uid === axisUid ? { ...axis, ...patch } : axis)));

  const firstPrice = parseMoneyInput(draft.skus[0]?.price ?? "");

  return (
    <div className="flex flex-col gap-8">
      <section className="flex flex-col gap-4" aria-labelledby="options-heading">
        <div>
          <h3 id="options-heading" className="font-medium">
            Options
          </h3>
          <p className="text-sm text-muted-foreground">
            Add options such as Size or Colour. Every combination becomes a variant with its own price and stock.
          </p>
        </div>
        <FieldError id="axes-error" message={errors.variantAxes} />
        {draft.axes.map((axis, index) => (
          <div key={axis.uid} className="grid gap-3 sm:grid-cols-[12rem_1fr_auto] sm:items-end">
            <TextField
              id={`axis-${axis.uid}-name`}
              label={`Option ${index + 1}`}
              placeholder="Size"
              value={axis.name}
              maxLength={30}
              onChange={(event) => editAxis(axis.uid, { name: event.currentTarget.value })}
              error={errors[`variantAxes.${index}.name`]}
            />
            <TextField
              id={`axis-${axis.uid}-values`}
              label="Values"
              placeholder="S, M, L, XL"
              value={axis.valuesText}
              onChange={(event) => editAxis(axis.uid, { valuesText: event.currentTarget.value })}
              error={errors[`variantAxes.${index}.values`]}
              hint="Separate values with commas."
            />
            <Button variant="ghost" onClick={() => setAxes(draft.axes.filter((item) => item.uid !== axis.uid))}>
              Remove
            </Button>
          </div>
        ))}
        {draft.axes.length < LISTING_LIMITS.variantAxesMax ? (
          <div>
            <Button variant="outline" size="sm" onClick={() => setAxes([...draft.axes, { uid: uid(), name: "", valuesText: "" }])}>
              Add option
            </Button>
          </div>
        ) : null}
      </section>

      <section className="flex flex-col gap-4" aria-labelledby="variants-heading">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h3 id="variants-heading" className="font-medium">
              Variants ({draft.skus.length})
            </h3>
            <p className="text-sm text-muted-foreground">Prices in {currency}.</p>
          </div>
          <div className="flex items-end gap-2">
            <div className="flex flex-col gap-1">
              <Label htmlFor="bulk-price">Set every price</Label>
              <Input id="bulk-price" inputMode="decimal" className="w-32" value={bulkPrice} onChange={(event) => setBulkPrice(event.currentTarget.value)} />
            </div>
            <Button
              variant="outline"
              size="sm"
              disabled={parseMoneyInput(bulkPrice) === null}
              onClick={() => draft.skus.forEach((sku) => updateSku(sku.uid, { price: bulkPrice.trim() }))}
            >
              Apply
            </Button>
          </div>
        </div>
        {warehouses.length === 0 ? (
          <Alert tone="warning" title="Add a warehouse to track stock">
            Stock is counted per warehouse, and buyers see where items ship from.{" "}
            <Link href="/seller/studio/warehouses" className="font-medium underline underline-offset-4">
              Add a warehouse
            </Link>
          </Alert>
        ) : null}
        <FieldError id="skus-error" message={errors.skus} />
        <div className="overflow-x-auto rounded-md border border-border">
          <table className="w-full min-w-[44rem] text-sm">
            <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
              <tr>
                <th scope="col" className="p-2 font-medium">
                  Variant
                </th>
                <th scope="col" className="p-2 font-medium">
                  SKU
                </th>
                <th scope="col" className="p-2 font-medium">
                  Price
                </th>
                <th scope="col" className="p-2 font-medium">
                  Compare at
                </th>
                {warehouses.map((warehouse) => (
                  <th key={warehouse.id} scope="col" className="p-2 font-medium">
                    Stock: {warehouse.name}
                  </th>
                ))}
                <th scope="col" className="p-2 font-medium">
                  Weight (g)
                </th>
                <th scope="col" className="p-2 font-medium">
                  For sale
                </th>
              </tr>
            </thead>
            <tbody>
              {draft.skus.map((sku, index) => {
                const label = variantLabel(sku.variantValues);
                const cellError = (field: string) => errors[`skus.${index}.${field}`];
                return (
                  <tr key={sku.uid} className="border-t border-border align-top">
                    <th scope="row" className="p-2 text-left font-medium">
                      {label}
                      <FieldError id={`sku-${sku.uid}-variant-error`} message={cellError("variantValues")} />
                    </th>
                    <td className="p-2">
                      <Input aria-label={`SKU code for ${label}`} value={sku.skuCode} maxLength={64} onChange={(event) => updateSku(sku.uid, { skuCode: event.currentTarget.value })} aria-invalid={cellError("skuCode") ? true : undefined} />
                      <FieldError id={`sku-${sku.uid}-code-error`} message={cellError("skuCode")} />
                    </td>
                    <td className="p-2">
                      <Input aria-label={`Price for ${label}`} inputMode="decimal" className="w-28" value={sku.price} onChange={(event) => updateSku(sku.uid, { price: event.currentTarget.value })} aria-invalid={cellError("price") ? true : undefined} />
                      <FieldError id={`sku-${sku.uid}-price-error`} message={cellError("price")} />
                    </td>
                    <td className="p-2">
                      <Input aria-label={`Compare-at price for ${label}`} inputMode="decimal" className="w-28" value={sku.compareAtPrice} onChange={(event) => updateSku(sku.uid, { compareAtPrice: event.currentTarget.value })} aria-invalid={cellError("compareAtPrice") ? true : undefined} />
                      <FieldError id={`sku-${sku.uid}-compare-error`} message={cellError("compareAtPrice")} />
                    </td>
                    {warehouses.map((warehouse) => (
                      <td key={warehouse.id} className="p-2">
                        <Input
                          aria-label={`Stock of ${label} in ${warehouse.name}`}
                          inputMode="numeric"
                          className="w-24"
                          value={sku.stock[warehouse.id] ?? "0"}
                          onChange={(event) => updateSku(sku.uid, { stock: { ...sku.stock, [warehouse.id]: event.currentTarget.value } })}
                        />
                      </td>
                    ))}
                    <td className="p-2">
                      <Input aria-label={`Weight in grams of ${label}`} inputMode="numeric" className="w-24" value={sku.weightGrams} onChange={(event) => updateSku(sku.uid, { weightGrams: event.currentTarget.value })} />
                      <FieldError id={`sku-${sku.uid}-weight-error`} message={cellError("weightGrams") ?? cellError("stock")} />
                    </td>
                    <td className="p-2">
                      <input
                        type="checkbox"
                        aria-label={`${label} is for sale`}
                        className="mt-3 h-4 w-4"
                        checked={sku.isActive}
                        onChange={(event) => updateSku(sku.uid, { isActive: event.currentTarget.checked })}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className="flex flex-col gap-4" aria-labelledby="wholesale-heading">
        <div>
          <h3 id="wholesale-heading" className="font-medium">
            Wholesale pricing (optional)
          </h3>
          <p className="text-sm text-muted-foreground">
            Reward bulk orders: buyers who order at least the minimum quantity of a variant pay less per unit.
          </p>
        </div>
        {draft.wholesale.map((tier, index) => {
          const bps = parseMoneyInput(tier.discountPct);
          const example = firstPrice !== null && bps !== null ? discountedUnitPrice(firstPrice, bps) : null;
          return (
            <div key={tier.uid} className="grid gap-3 sm:grid-cols-[10rem_10rem_1fr_auto] sm:items-end">
              <TextField
                id={`tier-${tier.uid}-qty`}
                label="Minimum quantity"
                inputMode="numeric"
                value={tier.minQty}
                onChange={(event) => set("wholesale", draft.wholesale.map((item) => (item.uid === tier.uid ? { ...item, minQty: event.currentTarget.value } : item)))}
                error={errors[`wholesaleTiers.${index}.minQty`] ?? errors[`wholesaleTiers.${index}`]}
              />
              <TextField
                id={`tier-${tier.uid}-discount`}
                label="Discount (%)"
                inputMode="decimal"
                value={tier.discountPct}
                onChange={(event) => set("wholesale", draft.wholesale.map((item) => (item.uid === tier.uid ? { ...item, discountPct: event.currentTarget.value } : item)))}
                error={errors[`wholesaleTiers.${index}.discountBps`]}
              />
              <p className="pb-2 text-sm text-muted-foreground">
                {example !== null ? `First variant: ${minorToInput(example)} ${currency} each` : ""}
              </p>
              <Button variant="ghost" onClick={() => set("wholesale", draft.wholesale.filter((item) => item.uid !== tier.uid))}>
                Remove
              </Button>
            </div>
          );
        })}
        {draft.wholesale.length < LISTING_LIMITS.wholesaleTiersMax ? (
          <div>
            <Button variant="outline" size="sm" onClick={() => set("wholesale", [...draft.wholesale, { uid: uid(), minQty: "", discountPct: "" }])}>
              Add wholesale tier
            </Button>
          </div>
        ) : null}
      </section>
    </div>
  );
}
