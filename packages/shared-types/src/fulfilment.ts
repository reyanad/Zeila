/** Carriers with public tracking pages; {n} is replaced by the tracking number. */
export const CARRIERS = {
  ethiopost: { name: "Ethiopian Postal Service (EMS)", trackingUrl: "https://t.17track.net/en#nums={n}" },
  dhl: { name: "DHL Express", trackingUrl: "https://www.dhl.com/global-en/home/tracking/tracking-express.html?submit=1&tracking-id={n}" },
  fedex: { name: "FedEx", trackingUrl: "https://www.fedex.com/fedextrack/?trknbr={n}" },
  ups: { name: "UPS", trackingUrl: "https://www.ups.com/track?tracknum={n}" },
  aramex: { name: "Aramex", trackingUrl: "https://t.17track.net/en#nums={n}" },
  local: { name: "Local courier or own delivery", trackingUrl: null },
  other: { name: "Other carrier", trackingUrl: "https://t.17track.net/en#nums={n}" },
} as const satisfies Record<string, { name: string; trackingUrl: string | null }>;

export type CarrierCode = keyof typeof CARRIERS;

export function isCarrierCode(value: string): value is CarrierCode {
  return value in CARRIERS;
}

export function trackingUrl(carrier: string, trackingNumber: string | null): string | null {
  if (!trackingNumber || !isCarrierCode(carrier)) return null;
  const template = CARRIERS[carrier].trackingUrl;
  return template ? template.replace("{n}", encodeURIComponent(trackingNumber)) : null;
}

export const RETURN_REASONS = {
  not_as_described: "Not as described",
  damaged: "Arrived damaged",
  wrong_item: "Wrong item sent",
  defective: "Does not work",
  changed_mind: "Changed my mind",
} as const;
export type ReturnReason = keyof typeof RETURN_REASONS;

export function isReturnReason(value: string): value is ReturnReason {
  return value in RETURN_REASONS;
}
