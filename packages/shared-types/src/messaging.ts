import { z } from "zod";
import { MAX_PRICE_MINOR } from "./money";

/**
 * Anti-circumvention screening for chat. Contact details are masked so deals
 * stay on the platform, where escrow protects both sides; talk of paying
 * outside the platform is flagged (not masked) so both sides see a warning
 * and staff can review repeat offenders.
 *
 * Long digit runs are treated as phone numbers, so a 10-digit tracking number
 * pasted into chat is hidden too; tracking is shown on the order page.
 */
export type ScreenReason = "email" | "phone" | "link" | "app" | "payment";

export interface ScreenResult {
  text: string;
  flagged: boolean;
  reasons: ScreenReason[];
}

const EMAIL = /[a-z0-9._%+-]+\s?(?:@|\(at\)|\[at\])\s?[a-z0-9.-]+\s?(?:\.|\(dot\)|\[dot\])\s?[a-z]{2,}/gi;
const PHONE = /(?:\+|00)?\d(?:[\s.\-()/]*\d){8,14}/g;
const LINK = /\b(?:https?:\/\/)?(?:www\.)?(?:t\.me|telegram\.(?:me|org)|wa\.me|chat\.whatsapp\.com|api\.whatsapp\.com|m\.me|viber\.click|signal\.me|instagram\.com|facebook\.com|fb\.com|tiktok\.com|linkedin\.com)\/\S*/gi;
const HANDLE = /(?:^|\s)@[a-z0-9_]{4,32}\b/gi;
const APP = /\b(?:whats\s?app|telegram|viber|signal\s+me|imo\s+(?:me|number)|skype|wechat|snapchat)\b|ቴሌግራም|ዋትሳፕ|ዋትስአፕ|ቫይበር/gi;
const PAYMENT =
  /\b(?:tele\s?birr|cbe\s?birr|m-?pesa|paypal|western\s?union|moneygram|payoneer|bank\s+(?:transfer|account)|account\s+number|pay\s+(?:me\s+)?(?:directly|outside|in\s+cash|off[-\s]?(?:platform|site|app))|outside\s+(?:the\s+|of\s+)?(?:app|platform|site|negadras|zeila)|cash\s+on\s+delivery|bitcoin|usdt|crypto\s?(?:currency|wallet)?)\b|ቴሌብር|ሲቢኢ\s?ብር|የባንክ\s?ሂሳብ|በቀጥታ\s?ክፈል/gi;

export const HIDDEN_CONTACT = "[contact hidden]";

export function screenMessage(input: string): ScreenResult {
  const reasons = new Set<ScreenReason>();
  let text = input;
  text = text.replace(EMAIL, () => {
    reasons.add("email");
    return HIDDEN_CONTACT;
  });
  text = text.replace(LINK, () => {
    reasons.add("link");
    return HIDDEN_CONTACT;
  });
  text = text.replace(PHONE, () => {
    reasons.add("phone");
    return HIDDEN_CONTACT;
  });
  text = text.replace(HANDLE, (match) => {
    reasons.add("link");
    return `${match.startsWith(" ") || match.startsWith("\n") ? match[0] : ""}${HIDDEN_CONTACT}`;
  });
  if (APP.test(text)) reasons.add("app");
  if (PAYMENT.test(text)) reasons.add("payment");
  APP.lastIndex = 0;
  PAYMENT.lastIndex = 0;
  return { text, flagged: reasons.size > 0, reasons: [...reasons] };
}

export const MESSAGE_MAX_LENGTH = 4_000;

export const OFFER_STATUSES = ["OPEN", "ACCEPTED", "DECLINED", "WITHDRAWN", "EXPIRED"] as const;
export type OfferStatus = (typeof OFFER_STATUSES)[number];

export const customOfferInputSchema = z.object({
  listingId: z.string().min(1, "Choose the service this offer is for"),
  title: z.string().trim().min(4, "Give the offer a short title").max(120),
  description: z.string().trim().min(10, "Describe what is included").max(2_000),
  price: z.number().int().min(100, "The price is too low").max(MAX_PRICE_MINOR),
  deliveryDays: z.number().int().min(1, "At least 1 day").max(365),
  revisions: z.number().int().min(-1).max(20),
  validDays: z.number().int().min(1).max(30),
});
export type CustomOfferInput = z.infer<typeof customOfferInputSchema>;

export const offerPayloadSchema = z.object({
  listingId: z.string(),
  title: z.string(),
  description: z.string(),
  price: z.number().int(),
  currency: z.string().length(3),
  deliveryDays: z.number().int(),
  revisions: z.number().int(),
  expiresAt: z.string(),
  status: z.enum(OFFER_STATUSES),
  orderId: z.string().nullable(),
});
export type OfferPayload = z.infer<typeof offerPayloadSchema>;

export const DISPUTE_REASONS = {
  NOT_RECEIVED: "I did not receive it",
  NOT_AS_DESCRIBED: "Not as described",
  DAMAGED: "Arrived damaged",
  LATE_DELIVERY: "Delivered very late",
  QUALITY: "Work quality is not acceptable",
  UNAUTHORIZED: "I did not make this purchase",
  OTHER: "Something else",
} as const;
export type DisputeReasonCode = keyof typeof DISPUTE_REASONS;

export function isDisputeReason(value: string): value is DisputeReasonCode {
  return value in DISPUTE_REASONS;
}

/** Days the other side has to answer before the case moves on automatically. */
export const DISPUTE_RESPONSE_DAYS = 3;
