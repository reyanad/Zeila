"use client";

import { STATUS_BADGE, type ListingStatusValue } from "./status-badge";
import Link from "next/link";
import { useState, useTransition } from "react";
import { fieldErrors, listingInputSchema, type ListingTypeValue } from "@marketplace/shared-types";
import { Alert, Badge, type BadgeTone, Button, buttonVariants, Card, CardContent, CardDescription, CardHeader, CardTitle, Label, Select } from "@marketplace/ui";
import { listingStatusAction, saveListingAction } from "@/lib/actions/studio";
import { BuilderContext, TextAreaField, TextField, useBuilder, useBuilderStore } from "./builder-context";
import { buildPayload, createBuilderStore, draftFromInput, remapErrors, type BuilderDraft, type WarehouseOption } from "./builder-store";
import { DigitalEditor } from "./digital-editor";
import { ImagesEditor } from "./images-editor";
import { PhysicalEditor } from "./physical-editor";
import { ServiceEditor } from "./service-editor";

export type { ListingStatusValue } from "./status-badge";

export { STATUS_BADGE } from "./status-badge";

const TYPE_TITLES: Record<ListingTypeValue, string> = {
  PHYSICAL: "Product details",
  DIGITAL: "Digital product",
  SERVICE: "Service packages",
};

export interface ListingBuilderProps {
  listingId: string | null;
  slug: string | null;
  status: ListingStatusValue | null;
  moderationNote: string | null;
  initial: BuilderDraft;
  warehouses: WarehouseOption[];
  categories: Array<{ value: string; label: string }>;
  currency: string;
  storeActive: boolean;
}

export function ListingBuilder(props: ListingBuilderProps) {
  const [store] = useState(() => createBuilderStore(props.initial));
  return (
    <BuilderContext.Provider value={store}>
      <BuilderBody {...props} />
    </BuilderContext.Provider>
  );
}

interface Notice {
  tone: "success" | "danger" | "info";
  text: string;
  items?: string[];
}

function BuilderBody({ listingId: initialId, slug: initialSlug, status: initialStatus, moderationNote, warehouses, categories, currency, storeActive }: ListingBuilderProps) {
  const store = useBuilderStore();
  const draft = useBuilder((state) => state.draft);
  const errors = useBuilder((state) => state.errors);
  const set = useBuilder((state) => state.set);
  const [listingId, setListingId] = useState(initialId);
  const [slug, setSlug] = useState(initialSlug);
  const [status, setStatus] = useState<ListingStatusValue | null>(initialStatus);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [pending, startTransition] = useTransition();

  const save = (publish: boolean) =>
    startTransition(async () => {
      setNotice(null);
      const built = buildPayload(store.getState().draft, warehouses);
      if (!built.payload) {
        store.getState().setErrors(built.errors);
        setNotice({ tone: "danger", text: "Check the highlighted fields." });
        return;
      }
      const parsed = listingInputSchema.safeParse(built.payload);
      if (!parsed.success) {
        store.getState().setErrors(remapErrors(fieldErrors(parsed.error), built.tierLevels));
        setNotice({ tone: "danger", text: "Check the highlighted fields." });
        return;
      }

      const result = await saveListingAction(parsed.data, listingId);
      if (!result.ok) {
        store.getState().setErrors(remapErrors(result.fields ?? {}, built.tierLevels));
        setNotice({ tone: "danger", text: result.message });
        return;
      }

      store.getState().reset(draftFromInput(result.input, result.imageUrls));
      setListingId(result.id);
      setSlug(result.slug);
      setStatus(result.status);
      if (!listingId) window.history.replaceState(null, "", `/seller/studio/listings/${result.id}`);

      if (!publish) {
        setNotice({ tone: "success", text: "Saved." });
        return;
      }
      const published = await listingStatusAction(result.id, "publish");
      if (!published.ok) {
        setNotice({ tone: "danger", text: `Saved, but not published: ${published.message}`, items: published.issues?.map((issue) => issue.message) });
        return;
      }
      if (published.status !== "DELETED") setStatus(published.status);
      setNotice({
        tone: "success",
        text: published.status === "PENDING_REVIEW" ? "Saved and sent for review. It goes live once approved." : "Published. Your listing is live.",
      });
    });

  const pause = () =>
    startTransition(async () => {
      if (!listingId) return;
      const result = await listingStatusAction(listingId, "pause");
      if (result.ok && result.status !== "DELETED") {
        setStatus(result.status);
        setNotice({ tone: "info", text: "Paused. Buyers cannot see it until you publish again." });
      } else if (!result.ok) {
        setNotice({ tone: "danger", text: result.message });
      }
    });

  const live = status === "ACTIVE";
  const canPublish = status !== "ACTIVE" && status !== "PENDING_REVIEW" && status !== "ARCHIVED";

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">{draft.title.trim() || "New listing"}</h1>
          {status ? <Badge tone={STATUS_BADGE[status].tone}>{STATUS_BADGE[status].label}</Badge> : null}
        </div>
        {live && slug ? (
          <Link href={`/listing/${slug}`} className={buttonVariants({ variant: "outline", size: "sm" })}>
            View in store
          </Link>
        ) : null}
      </div>

      {!storeActive ? (
        <Alert tone="info">
          You can prepare listings now. Publishing unlocks once your store is active.{" "}
          <Link href="/seller/onboarding" className="font-medium underline underline-offset-4">
            Finish seller setup
          </Link>
        </Alert>
      ) : null}
      {status === "REJECTED" && moderationNote ? (
        <Alert tone="danger" title="Changes requested by our moderators">
          {moderationNote}
        </Alert>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Basics</CardTitle>
          <CardDescription>What buyers see first in search and on the listing page.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <TextField id="title" label="Title" value={draft.title} maxLength={140} onChange={(event) => set("title", event.currentTarget.value)} error={errors.title} />
          <TextField
            id="summary"
            label="Short summary"
            value={draft.summary}
            maxLength={280}
            onChange={(event) => set("summary", event.currentTarget.value)}
            error={errors.summary}
            hint="One or two sentences shown in search results."
          />
          <TextAreaField
            id="description"
            label="Description"
            rows={8}
            value={draft.description}
            maxLength={20_000}
            onChange={(event) => set("description", event.currentTarget.value)}
            error={errors.description}
            hint="Markdown is supported: **bold**, lists, links."
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-2">
              <Label htmlFor="category">Category</Label>
              <Select id="category" value={draft.categoryId} onChange={(event) => set("categoryId", event.currentTarget.value)} aria-invalid={errors.categoryId ? true : undefined}>
                <option value="">No category</option>
                {categories.map((category) => (
                  <option key={category.value} value={category.value}>
                    {category.label}
                  </option>
                ))}
              </Select>
              {errors.categoryId ? <p className="text-xs font-medium text-destructive">{errors.categoryId}</p> : null}
            </div>
            <TextField
              id="tags"
              label="Tags"
              value={draft.tagsText}
              onChange={(event) => set("tagsText", event.currentTarget.value)}
              error={errors.tags}
              hint="Comma separated, e.g. handmade, cotton, gift."
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Photos</CardTitle>
          <CardDescription>Up to eight photos. Drag order with the arrows; the first is the cover.</CardDescription>
        </CardHeader>
        <CardContent>
          <ImagesEditor />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{TYPE_TITLES[draft.type]}</CardTitle>
        </CardHeader>
        <CardContent>
          {draft.type === "PHYSICAL" ? <PhysicalEditor warehouses={warehouses} currency={currency} /> : null}
          {draft.type === "DIGITAL" ? <DigitalEditor currency={currency} /> : null}
          {draft.type === "SERVICE" ? <ServiceEditor currency={currency} /> : null}
        </CardContent>
      </Card>

      <div className="sticky bottom-0 z-10 -mx-4 flex flex-col gap-3 border-t border-border bg-background/95 px-4 py-3 backdrop-blur">
        {notice ? (
          <Alert tone={notice.tone}>
            {notice.text}
            {notice.items && notice.items.length > 0 ? (
              <ul className="mt-2 list-disc pl-5">
                {notice.items.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            ) : null}
          </Alert>
        ) : null}
        <div className="flex flex-wrap items-center justify-end gap-2">
          <Link href="/seller/studio" className={buttonVariants({ variant: "ghost" })}>
            Back to listings
          </Link>
          {live ? (
            <Button variant="outline" onClick={pause} disabled={pending}>
              Pause
            </Button>
          ) : null}
          <Button variant={canPublish ? "outline" : "default"} onClick={() => save(false)} disabled={pending || status === "ARCHIVED"} aria-busy={pending}>
            {pending ? "Saving…" : live ? "Save changes" : "Save draft"}
          </Button>
          {canPublish ? (
            <Button onClick={() => save(true)} disabled={pending || !storeActive}>
              Save and publish
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
