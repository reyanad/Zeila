"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@marketplace/ui";
import { listingStatusAction } from "@/lib/actions/studio";
import type { ListingStatusValue } from "./listing-builder";

/** Quick status changes from the listings table. */
export function ListingRowActions({ listingId, status }: { listingId: string; status: ListingStatusValue }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const run = (action: "publish" | "pause" | "archive" | "delete") =>
    startTransition(async () => {
      setError(null);
      const result = await listingStatusAction(listingId, action);
      if (!result.ok) {
        setError(result.issues?.[0]?.message ?? result.message);
        return;
      }
      router.refresh();
    });

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex flex-wrap justify-end gap-1">
        {status === "ACTIVE" ? (
          <Button size="sm" variant="ghost" disabled={pending} onClick={() => run("pause")}>
            Pause
          </Button>
        ) : null}
        {status === "PAUSED" || status === "DRAFT" || status === "REJECTED" ? (
          <Button size="sm" variant="ghost" disabled={pending} onClick={() => run("publish")}>
            Publish
          </Button>
        ) : null}
        {status !== "ARCHIVED" && status !== "DRAFT" ? (
          <Button size="sm" variant="ghost" disabled={pending} onClick={() => run("archive")}>
            Archive
          </Button>
        ) : null}
        {status === "DRAFT" ? (
          <Button size="sm" variant="ghost" disabled={pending} onClick={() => run("delete")}>
            Delete
          </Button>
        ) : null}
      </div>
      {error ? (
        <p role="alert" className="max-w-56 text-right text-xs font-medium text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
