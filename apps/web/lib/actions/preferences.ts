"use server";

import { cookies } from "next/headers";
import { isSupportedCurrency } from "@marketplace/shared-types";
import { VIEWER_CURRENCY_COOKIE } from "@/lib/storefront/fx";

export async function setViewerCurrencyAction(currency: string): Promise<{ ok: boolean }> {
  if (!isSupportedCurrency(currency)) return { ok: false };
  (await cookies()).set(VIEWER_CURRENCY_COOKIE, currency, {
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
    sameSite: "lax",
    httpOnly: false,
  });
  return { ok: true };
}
