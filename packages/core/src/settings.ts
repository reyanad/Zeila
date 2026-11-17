import { z } from "zod";
import { prisma, type Prisma } from "@marketplace/database";
import { TAX_RATES_SETTING_KEY, taxRatesSchema } from "@marketplace/shared-types";

/**
 * Typed platform settings (`PlatformSetting` rows), edited in the admin
 * command center. Missing or malformed values fall back to the default.
 */
export const PLATFORM_SETTINGS = {
  /** "post": listings go live on publish, moderators review afterwards; "pre": review first. */
  listingReviewMode: { key: "listing_review_mode", schema: z.enum(["pre", "post"]), fallback: "post" as const },
  /** Commission in basis points on every sale (a store may override it). */
  platformFeeBps: { key: "platform_fee_bps", schema: z.number().int().min(0).max(5_000), fallback: 500 },
  /** Days after delivery before escrow releases automatically. */
  escrowHoldDays: { key: "escrow_hold_days", schema: z.number().int().min(0).max(60), fallback: 3 },
  /** Destination country -> tax rule. Empty: no tax is charged. */
  taxRates: { key: TAX_RATES_SETTING_KEY, schema: taxRatesSchema, fallback: {} as z.infer<typeof taxRatesSchema> },
} as const;

export type SettingName = keyof typeof PLATFORM_SETTINGS;
export type SettingValue<N extends SettingName> = z.infer<(typeof PLATFORM_SETTINGS)[N]["schema"]>;

export async function getSetting<N extends SettingName>(name: N): Promise<SettingValue<N>> {
  const definition = PLATFORM_SETTINGS[name];
  const row = await prisma.platformSetting.findUnique({ where: { key: definition.key } });
  if (!row) return definition.fallback as SettingValue<N>;
  const parsed = definition.schema.safeParse(row.value);
  return (parsed.success ? parsed.data : definition.fallback) as SettingValue<N>;
}

export async function setSetting<N extends SettingName>(name: N, value: SettingValue<N>): Promise<void> {
  const definition = PLATFORM_SETTINGS[name];
  const parsed = definition.schema.parse(value) as Prisma.InputJsonValue;
  await prisma.platformSetting.upsert({
    where: { key: definition.key },
    create: { key: definition.key, value: parsed },
    update: { value: parsed },
  });
}
