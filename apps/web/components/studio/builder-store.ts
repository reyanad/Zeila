import { createStore, type StoreApi } from "zustand/vanilla";
import {
  minorToInput,
  parseMoneyInput,
  SERVICE_TIER_LEVELS,
  type DigitalAssetRef,
  type IntakeFieldKind,
  type ListingInput,
  type ListingTypeValue,
  type ServiceTierLevelValue,
} from "@marketplace/shared-types";

/**
 * Client-side state for the listing builder. Inputs are kept as the strings
 * people type; `buildPayload` turns them into the typed `ListingInput` that
 * the shared Zod schema (and the server) validate.
 */

export interface ImageDraft {
  key: string;
  url: string;
  alt: string;
}
export interface AxisDraft {
  uid: string;
  name: string;
  valuesText: string;
}
export interface SkuDraft {
  uid: string;
  id: string | null;
  skuCode: string;
  variantValues: Record<string, string>;
  price: string;
  compareAtPrice: string;
  barcode: string;
  weightGrams: string;
  isActive: boolean;
  /** On-hand stock per warehouse id. */
  stock: Record<string, string>;
}
export interface WholesaleDraft {
  uid: string;
  minQty: string;
  discountPct: string;
}
export interface DigitalDraft {
  price: string;
  asset: DigitalAssetRef | null;
  version: string;
  changelog: string;
  licenseKeys: boolean;
  licensePrefix: string;
  activationsLimit: string;
  downloadLimit: string;
}
export interface ServiceTierDraft {
  enabled: boolean;
  title: string;
  description: string;
  price: string;
  deliveryDays: string;
  revisions: string;
  unlimitedRevisions: boolean;
  featuresText: string;
}
export interface IntakeDraft {
  uid: string;
  id: string;
  label: string;
  kind: IntakeFieldKind;
  required: boolean;
  optionsText: string;
}

export interface BuilderDraft {
  type: ListingTypeValue;
  title: string;
  summary: string;
  description: string;
  categoryId: string;
  tagsText: string;
  images: ImageDraft[];
  axes: AxisDraft[];
  skus: SkuDraft[];
  wholesale: WholesaleDraft[];
  digital: DigitalDraft;
  service: Record<ServiceTierLevelValue, ServiceTierDraft>;
  intake: IntakeDraft[];
}

export interface WarehouseOption {
  id: string;
  name: string;
}

let uidCounter = 0;
export function uid(): string {
  uidCounter += 1;
  return `u${Date.now().toString(36)}${uidCounter.toString(36)}`;
}

const LEVEL_TITLES: Record<ServiceTierLevelValue, string> = { BASIC: "Basic", STANDARD: "Standard", PREMIUM: "Premium" };

function emptyTier(level: ServiceTierLevelValue): ServiceTierDraft {
  return {
    enabled: level === "BASIC",
    title: LEVEL_TITLES[level],
    description: "",
    price: "",
    deliveryDays: level === "BASIC" ? "3" : level === "STANDARD" ? "5" : "7",
    revisions: level === "BASIC" ? "1" : level === "STANDARD" ? "2" : "3",
    unlimitedRevisions: false,
    featuresText: "",
  };
}

export function emptySku(variantValues: Record<string, string> = {}, skuCode = "", price = ""): SkuDraft {
  return {
    uid: uid(),
    id: null,
    skuCode,
    variantValues,
    price,
    compareAtPrice: "",
    barcode: "",
    weightGrams: "",
    isActive: true,
    stock: {},
  };
}

export function emptyDraft(type: ListingTypeValue): BuilderDraft {
  return {
    type,
    title: "",
    summary: "",
    description: "",
    categoryId: "",
    tagsText: "",
    images: [],
    axes: [],
    skus: type === "PHYSICAL" ? [emptySku({}, "SKU-1")] : [],
    wholesale: [],
    digital: {
      price: "",
      asset: null,
      version: "1.0",
      changelog: "",
      licenseKeys: false,
      licensePrefix: "",
      activationsLimit: "3",
      downloadLimit: "",
    },
    service: { BASIC: emptyTier("BASIC"), STANDARD: emptyTier("STANDARD"), PREMIUM: emptyTier("PREMIUM") },
    intake: [],
  };
}

export function draftFromInput(input: ListingInput, imageUrls: Record<string, string>): BuilderDraft {
  const draft = emptyDraft(input.type);
  draft.title = input.title;
  draft.summary = input.summary;
  draft.description = input.description;
  draft.categoryId = input.categoryId ?? "";
  draft.tagsText = input.tags.join(", ");
  draft.images = input.images.map((image) => ({ key: image.key, url: imageUrls[image.key] ?? "", alt: image.alt }));

  if (input.type === "PHYSICAL") {
    draft.axes = input.variantAxes.map((axis) => ({ uid: uid(), name: axis.name, valuesText: axis.values.join(", ") }));
    draft.skus = input.skus.map((sku) => ({
      uid: uid(),
      id: sku.id,
      skuCode: sku.skuCode,
      variantValues: sku.variantValues,
      price: minorToInput(sku.price),
      compareAtPrice: sku.compareAtPrice === null ? "" : minorToInput(sku.compareAtPrice),
      barcode: sku.barcode ?? "",
      weightGrams: sku.weightGrams === null ? "" : String(sku.weightGrams),
      isActive: sku.isActive,
      stock: Object.fromEntries(sku.stock.map((level) => [level.warehouseId, String(level.onHand)])),
    }));
    if (draft.skus.length === 0) draft.skus = [emptySku({}, "SKU-1")];
    draft.wholesale = input.wholesaleTiers.map((tier) => ({
      uid: uid(),
      minQty: String(tier.minQty),
      discountPct: minorToInput(tier.discountBps),
    }));
  }
  if (input.type === "DIGITAL") {
    draft.digital = {
      price: minorToInput(input.price),
      asset: input.asset,
      version: input.version,
      changelog: input.changelog,
      licenseKeys: input.licenseKeys,
      licensePrefix: input.licensePrefix ?? "",
      activationsLimit: String(input.activationsLimit),
      downloadLimit: input.downloadLimit === null ? "" : String(input.downloadLimit),
    };
  }
  if (input.type === "SERVICE") {
    for (const tier of input.tiers) {
      draft.service[tier.level] = {
        enabled: true,
        title: tier.title,
        description: tier.description,
        price: minorToInput(tier.price),
        deliveryDays: String(tier.deliveryDays),
        revisions: tier.revisions < 0 ? "1" : String(tier.revisions),
        unlimitedRevisions: tier.revisions < 0,
        featuresText: tier.features.join("\n"),
      };
    }
    draft.intake = input.intakeFields.map((field) => ({
      uid: uid(),
      id: field.id,
      label: field.label,
      kind: field.kind,
      required: field.required,
      optionsText: field.options.join("\n"),
    }));
  }
  return draft;
}

// ---------------------------------------------------------------------------
// Variant matrix
// ---------------------------------------------------------------------------

/** Comma- or newline-separated values, trimmed, without blanks or case-insensitive duplicates. */
export function splitList(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of text.split(/[,\n]/)) {
    const value = raw.trim();
    const key = value.toLowerCase();
    if (value.length === 0 || seen.has(key)) continue;
    seen.add(key);
    out.push(value);
  }
  return out;
}

function codePart(value: string): string {
  return value.toUpperCase().replace(/[^A-Z0-9]+/g, "").slice(0, 6) || "X";
}

function combinations(axes: Array<{ name: string; values: string[] }>): Array<Record<string, string>> {
  return axes.reduce<Array<Record<string, string>>>(
    (acc, axis) => acc.flatMap((combo) => axis.values.map((value) => ({ ...combo, [axis.name]: value }))),
    [{}],
  );
}

/**
 * Rebuild the SKU list after the options change, keeping prices, codes and
 * stock of rows whose option values are unchanged. Rows are matched by
 * position of the option, so renaming "Colour" to "Color" keeps the rows.
 */
export function regenerateSkus(previousAxes: AxisDraft[], nextAxes: AxisDraft[], skus: SkuDraft[], codeBase: string): SkuDraft[] {
  const prev = previousAxes.map((axis) => ({ name: axis.name.trim(), values: splitList(axis.valuesText) }));
  const next = nextAxes
    .map((axis) => ({ name: axis.name.trim(), values: splitList(axis.valuesText) }))
    .filter((axis) => axis.name.length > 0 && axis.values.length > 0);

  if (next.length === 0) {
    const first = skus[0];
    return [first ? { ...first, variantValues: {} } : emptySku({}, `${codeBase}-1`)];
  }

  const tupleOf = (sku: SkuDraft) => prev.map((axis) => sku.variantValues[axis.name] ?? "").join("\u0000");
  const byTuple = new Map(skus.map((sku) => [tupleOf(sku), sku]));
  const fallbackPrice = skus[0]?.price ?? "";

  return combinations(next).map((combo) => {
    const tuple = next.map((axis) => combo[axis.name] ?? "").join("\u0000");
    const existing = next.length === prev.length ? byTuple.get(tuple) : undefined;
    if (existing) return { ...existing, variantValues: combo };
    const code = [codeBase, ...next.map((axis) => codePart(combo[axis.name] ?? ""))].join("-");
    return emptySku(combo, code.slice(0, 64), fallbackPrice);
  });
}

// ---------------------------------------------------------------------------
// Draft -> payload
// ---------------------------------------------------------------------------

export interface PayloadResult {
  payload: ListingInput | null;
  errors: Record<string, string>;
  /** Service levels in payload order, to map `tiers.<i>` errors back to a level. */
  tierLevels: ServiceTierLevelValue[];
}

export function buildPayload(draft: BuilderDraft, warehouses: readonly WarehouseOption[]): PayloadResult {
  const errors: Record<string, string> = {};

  const money = (text: string, key: string): number => {
    const value = parseMoneyInput(text);
    if (value === null) errors[key] = text.trim() === "" ? "Enter a price" : "Use a price like 12.50";
    return value ?? 0;
  };
  const optionalMoney = (text: string, key: string): number | null => (text.trim() === "" ? null : money(text, key));
  const integer = (text: string, key: string, label: string): number => {
    const trimmed = text.trim();
    if (!/^\d{1,9}$/.test(trimmed)) {
      errors[key] = trimmed === "" ? `Enter ${label}` : `${label[0]?.toUpperCase()}${label.slice(1)} must be a whole number`;
      return 0;
    }
    return Number(trimmed);
  };
  const optionalInteger = (text: string, key: string, label: string): number | null =>
    text.trim() === "" ? null : integer(text, key, label);

  const common = {
    title: draft.title,
    summary: draft.summary,
    description: draft.description,
    categoryId: draft.categoryId === "" ? null : draft.categoryId,
    tags: splitList(draft.tagsText),
    images: draft.images.map((image, position) => ({ key: image.key, alt: image.alt, position })),
  };

  let payload: ListingInput;
  const tierLevels: ServiceTierLevelValue[] = [];

  switch (draft.type) {
    case "PHYSICAL": {
      payload = {
        type: "PHYSICAL",
        ...common,
        variantAxes: draft.axes
          .map((axis) => ({ name: axis.name.trim(), values: splitList(axis.valuesText) }))
          .filter((axis) => axis.name.length > 0 || axis.values.length > 0),
        skus: draft.skus.map((sku, index) => ({
          id: sku.id,
          skuCode: sku.skuCode.trim(),
          variantValues: sku.variantValues,
          price: money(sku.price, `skus.${index}.price`),
          compareAtPrice: optionalMoney(sku.compareAtPrice, `skus.${index}.compareAtPrice`),
          barcode: sku.barcode.trim() === "" ? null : sku.barcode.trim(),
          weightGrams: optionalInteger(sku.weightGrams, `skus.${index}.weightGrams`, "weight"),
          isActive: sku.isActive,
          stock: warehouses.map((warehouse) => ({
            warehouseId: warehouse.id,
            onHand: integer(sku.stock[warehouse.id] ?? "0", `skus.${index}.stock`, "stock"),
          })),
        })),
        wholesaleTiers: draft.wholesale.map((tier, index) => {
          const bps = parseMoneyInput(tier.discountPct);
          if (bps === null) errors[`wholesaleTiers.${index}.discountBps`] = "Use a percentage like 10 or 12.5";
          return { minQty: integer(tier.minQty, `wholesaleTiers.${index}.minQty`, "a quantity"), discountBps: bps ?? 0 };
        }),
      };
      break;
    }
    case "DIGITAL": {
      const digital = draft.digital;
      payload = {
        type: "DIGITAL",
        ...common,
        price: money(digital.price, "price"),
        asset: digital.asset,
        version: digital.version,
        changelog: digital.changelog,
        licenseKeys: digital.licenseKeys,
        licensePrefix: digital.licenseKeys && digital.licensePrefix.trim() !== "" ? digital.licensePrefix.trim() : null,
        activationsLimit: integer(digital.activationsLimit, "activationsLimit", "a number"),
        downloadLimit: optionalInteger(digital.downloadLimit, "downloadLimit", "a number"),
      };
      break;
    }
    case "SERVICE": {
      const tiers = SERVICE_TIER_LEVELS.filter((level) => draft.service[level].enabled).map((level) => {
        tierLevels.push(level);
        const tier = draft.service[level];
        return {
          level,
          title: tier.title,
          description: tier.description,
          price: money(tier.price, `service.${level}.price`),
          deliveryDays: integer(tier.deliveryDays, `service.${level}.deliveryDays`, "days"),
          revisions: tier.unlimitedRevisions ? -1 : integer(tier.revisions, `service.${level}.revisions`, "revisions"),
          features: splitLines(tier.featuresText),
        };
      });
      payload = {
        type: "SERVICE",
        ...common,
        tiers,
        intakeFields: draft.intake.map((field) => ({
          id: field.id,
          label: field.label,
          kind: field.kind,
          required: field.required,
          options: field.kind === "select" ? splitLines(field.optionsText) : [],
        })),
      };
      break;
    }
  }

  return { payload: Object.keys(errors).length > 0 ? null : payload, errors, tierLevels };
}

export function splitLines(text: string): string[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

/** Map server/schema error keys onto the keys the builder renders. */
export function remapErrors(errors: Record<string, string>, tierLevels: readonly ServiceTierLevelValue[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, message] of Object.entries(errors)) {
    const match = /^tiers\.(\d+)\.(.+)$/.exec(key);
    const level = match ? tierLevels[Number(match[1])] : undefined;
    out[level && match ? `service.${level}.${match[2]}` : key] = message;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export interface BuilderState {
  draft: BuilderDraft;
  errors: Record<string, string>;
  set: <K extends keyof BuilderDraft>(key: K, value: BuilderDraft[K]) => void;
  setAxes: (axes: AxisDraft[]) => void;
  updateSku: (skuUid: string, patch: Partial<SkuDraft>) => void;
  updateDigital: (patch: Partial<DigitalDraft>) => void;
  updateTier: (level: ServiceTierLevelValue, patch: Partial<ServiceTierDraft>) => void;
  setErrors: (errors: Record<string, string>) => void;
  reset: (draft: BuilderDraft) => void;
}

export type BuilderStore = StoreApi<BuilderState>;

function codeBaseFor(title: string): string {
  const letters = title
    .split(/\s+/)
    .map((word) => word.replace(/[^A-Za-z0-9]/g, "").slice(0, 1).toUpperCase())
    .join("")
    .slice(0, 4);
  return letters.length >= 2 ? letters : "SKU";
}

export function createBuilderStore(initial: BuilderDraft): BuilderStore {
  return createStore<BuilderState>()((set) => ({
    draft: initial,
    errors: {},
    set: (key, value) => set((state) => ({ draft: { ...state.draft, [key]: value } })),
    setAxes: (axes) =>
      set((state) => ({
        draft: {
          ...state.draft,
          axes,
          skus: regenerateSkus(state.draft.axes, axes, state.draft.skus, codeBaseFor(state.draft.title)),
        },
      })),
    updateSku: (skuUid, patch) =>
      set((state) => ({
        draft: { ...state.draft, skus: state.draft.skus.map((sku) => (sku.uid === skuUid ? { ...sku, ...patch } : sku)) },
      })),
    updateDigital: (patch) => set((state) => ({ draft: { ...state.draft, digital: { ...state.draft.digital, ...patch } } })),
    updateTier: (level, patch) =>
      set((state) => ({
        draft: { ...state.draft, service: { ...state.draft.service, [level]: { ...state.draft.service[level], ...patch } } },
      })),
    setErrors: (errors) => set({ errors }),
    reset: (draft) => set({ draft, errors: {} }),
  }));
}
