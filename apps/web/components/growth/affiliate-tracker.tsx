"use client";

import { useEffect } from "react";

/** Picks up `?ref=CODE` on any page and hands it to the server once. */
export function AffiliateTracker() {
  useEffect(() => {
    const code = new URLSearchParams(window.location.search).get("ref");
    if (!code || !/^[A-Za-z2-9]{8}$/.test(code)) return;
    const key = `aff-seen-${code.toUpperCase()}`;
    try {
      if (sessionStorage.getItem(key)) return;
      sessionStorage.setItem(key, "1");
    } catch {
      // Storage can be unavailable (private mode); the server de-duplicates by cookie.
    }
    void fetch("/api/affiliates/click", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code }) }).catch(() => undefined);
  }, []);
  return null;
}
