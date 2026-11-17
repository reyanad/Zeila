import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { prisma } from "@marketplace/database";
import { FX_RATES_SETTING_KEY, fxRatesSchema, isSupportedCurrency, type CurrencyCode, type FxRates } from "@marketplace/shared-types";
import { getEnv } from "@/lib/env";

export const VIEWER_CURRENCY_COOKIE = "currency";

/** Latest exchange rates written by the worker, or null if none were fetched yet. */
export const getFxRates = cache(async (): Promise<FxRates | null> => {
  const row = await prisma.platformSetting.findUnique({ where: { key: FX_RATES_SETTING_KEY } });
  if (!row) return null;
  const parsed = fxRatesSchema.safeParse(row.value);
  return parsed.success ? parsed.data : null;
});

/** Currency the visitor chose for approximate conversions. */
export const getViewerCurrency = cache(async (): Promise<CurrencyCode> => {
  const chosen = (await cookies()).get(VIEWER_CURRENCY_COOKIE)?.value;
  if (chosen && isSupportedCurrency(chosen)) return chosen;
  const fallback = getEnv().NEXT_PUBLIC_DEFAULT_CURRENCY;
  return isSupportedCurrency(fallback) ? fallback : "USD";
});
