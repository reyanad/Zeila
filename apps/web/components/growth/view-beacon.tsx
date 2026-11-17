"use client";

import { useEffect } from "react";

export function ViewBeacon({ listingId }: { listingId: string }) {
  useEffect(() => {
    const key = `viewed-${listingId}`;
    try {
      if (sessionStorage.getItem(key)) return;
      sessionStorage.setItem(key, "1");
    } catch {
      // Count anyway; the endpoint is rate limited.
    }
    void fetch(`/api/listings/${listingId}/view`, { method: "POST", keepalive: true }).catch(() => undefined);
  }, [listingId]);
  return null;
}
