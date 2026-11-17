"use client";

import { useId, useState, useTransition } from "react";
import { LISTING_LIMITS } from "@marketplace/shared-types";
import { Alert, Button, Input } from "@marketplace/ui";
import { uploadListingImageAction } from "@/lib/actions/studio";
import { FieldError, useBuilder } from "./builder-context";
import type { ImageDraft } from "./builder-store";

export function ImagesEditor() {
  const images = useBuilder((state) => state.draft.images);
  const set = useBuilder((state) => state.set);
  const errors = useBuilder((state) => state.errors);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const inputId = useId();
  const remaining = LISTING_LIMITS.imagesMax - images.length;

  const replace = (next: ImageDraft[]) => set("images", next);
  const move = (index: number, delta: number) => {
    const target = index + delta;
    if (target < 0 || target >= images.length) return;
    const next = [...images];
    const [item] = next.splice(index, 1);
    if (item) next.splice(target, 0, item);
    replace(next);
  };

  const upload = (files: FileList) => {
    const selected = Array.from(files).slice(0, remaining);
    if (selected.length === 0) return;
    setUploadError(null);
    startTransition(async () => {
      const added: ImageDraft[] = [];
      for (const file of selected) {
        const formData = new FormData();
        formData.append("image", file);
        const result = await uploadListingImageAction(formData);
        if (!result.ok) {
          setUploadError(`${file.name}: ${result.message}`);
          break;
        }
        added.push({ key: result.key, url: result.url, alt: "" });
      }
      if (added.length > 0) set("images", [...images, ...added]);
    });
  };

  return (
    <div className="flex flex-col gap-4">
      {uploadError ? <Alert tone="danger">{uploadError}</Alert> : null}
      <FieldError id="images-error" message={errors.images} />
      {images.length > 0 ? (
        <ol className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          {images.map((image, index) => (
            <li key={image.key} className="flex flex-col gap-2 rounded-md border border-border p-2">
              {/* eslint-disable-next-line @next/next/no-img-element -- seller uploads are already resized WebP */}
              <img src={image.url} alt={image.alt || `Photo ${index + 1}`} className="aspect-square w-full rounded object-cover" />
              {index === 0 ? <span className="text-xs font-medium text-muted-foreground">Cover photo</span> : null}
              <Input
                aria-label={`Description of photo ${index + 1}`}
                placeholder="Describe the photo"
                value={image.alt}
                maxLength={200}
                onChange={(event) => replace(images.map((item, i) => (i === index ? { ...item, alt: event.currentTarget.value } : item)))}
              />
              <FieldError id={`images-${index}-error`} message={errors[`images.${index}`]} />
              <div className="flex gap-1">
                <Button size="sm" variant="ghost" onClick={() => move(index, -1)} disabled={index === 0} aria-label={`Move photo ${index + 1} earlier`}>
                  ←
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => move(index, 1)}
                  disabled={index === images.length - 1}
                  aria-label={`Move photo ${index + 1} later`}
                >
                  →
                </Button>
                <Button size="sm" variant="ghost" onClick={() => replace(images.filter((_, i) => i !== index))}>
                  Remove
                </Button>
              </div>
            </li>
          ))}
        </ol>
      ) : (
        <p className="text-sm text-muted-foreground">No photos yet. The first photo becomes the cover.</p>
      )}
      {remaining > 0 ? (
        <div className="flex flex-col gap-2">
          <label htmlFor={inputId} className="text-sm font-medium">
            {pending ? "Uploading…" : "Add photos"}
          </label>
          <Input
            id={inputId}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            multiple
            disabled={pending}
            onChange={(event) => {
              const files = event.currentTarget.files;
              if (files) upload(files);
              event.currentTarget.value = "";
            }}
          />
          <p className="text-xs text-muted-foreground">
            JPEG, PNG or WebP up to 10 MB, {remaining} more allowed. Location data is removed from every photo.
          </p>
        </div>
      ) : null}
    </div>
  );
}
