import { prisma, type Prisma } from "@marketplace/database";
import { FX_RATES_SETTING_KEY, fxRatesSchema, SUPPORTED_CURRENCIES, type FxRates } from "@marketplace/shared-types";
import { z } from "zod";

export async function loadFxRates(): Promise<FxRates | null> {
  const row = await prisma.platformSetting.findUnique({ where: { key: FX_RATES_SETTING_KEY } });
  if (!row) return null;
  const parsed = fxRatesSchema.safeParse(row.value);
  return parsed.success ? parsed.data : null;
}

const providerSchema = z.object({
  result: z.string().optional(),
  base_code: z.string().optional(),
  rates: z.record(z.string(), z.number()),
});

/** Fetch USD-based rates for the supported currencies and store them. */
export async function refreshFxRates(url: string): Promise<FxRates> {
  const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error(`FX provider answered ${response.status}`);
  const body = providerSchema.parse(await response.json());
  if (body.base_code && body.base_code !== "USD") throw new Error(`FX provider base is ${body.base_code}, expected USD`);

  const rates: FxRates["rates"] = { USD: 1 };
  for (const code of SUPPORTED_CURRENCIES) {
    const rate = body.rates[code];
    if (typeof rate === "number" && rate > 0) rates[code] = rate;
  }
  const fx = fxRatesSchema.parse({ base: "USD", rates, fetchedAt: new Date().toISOString() });
  const value = fx as unknown as Prisma.InputJsonValue;
  await prisma.platformSetting.upsert({
    where: { key: FX_RATES_SETTING_KEY },
    create: { key: FX_RATES_SETTING_KEY, value },
    update: { value },
  });
  return fx;
}
