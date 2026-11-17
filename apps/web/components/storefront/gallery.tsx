"use client";

import { useState } from "react";
import { cn } from "@marketplace/ui";

export interface GalleryImage {
  url: string;
  alt: string;
}

export function Gallery({ images, title }: { images: GalleryImage[]; title: string }) {
  const [active, setActive] = useState(0);
  const current = images[active];
  if (!current) {
    return <div className="flex aspect-square items-center justify-center rounded-lg bg-muted text-sm text-muted-foreground">No photos</div>;
  }
  return (
    <div className="flex flex-col gap-3">
      {/* eslint-disable-next-line @next/next/no-img-element -- storage images are pre-sized WebP */}
      <img src={current.url} alt={current.alt || title} className="aspect-square w-full rounded-lg bg-muted object-cover" />
      {images.length > 1 ? (
        <div className="flex gap-2 overflow-x-auto" role="tablist" aria-label="Photos">
          {images.map((image, index) => (
            <button
              key={image.url}
              type="button"
              role="tab"
              aria-selected={index === active}
              aria-label={`Photo ${index + 1}`}
              onClick={() => setActive(index)}
              className={cn("h-16 w-16 shrink-0 overflow-hidden rounded-md border-2", index === active ? "border-primary" : "border-transparent")}
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- thumbnails of pre-sized images */}
              <img src={image.url} alt="" className="h-full w-full object-cover" />
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
