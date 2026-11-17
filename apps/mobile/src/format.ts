import { formatMoney, isSupportedCurrency } from "@marketplace/shared-types";

export function money(amount: number, currency: string): string {
  return isSupportedCurrency(currency) ? formatMoney({ amount, currency }) : `${(amount / 100).toFixed(2)} ${currency}`;
}

export function priceRange(min: number, max: number, currency: string, discountBps = 0): string {
  const off = (value: number) => Math.round((value * (10_000 - discountBps)) / 10_000);
  const low = money(off(min), currency);
  return max > min ? `${low} – ${money(off(max), currency)}` : low;
}

export function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

export function timeAgo(iso: string, now = Date.now()): string {
  const seconds = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (seconds < 60) return "now";
  if (seconds < 3_600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3_600)}h`;
  return `${Math.floor(seconds / 86_400)}d`;
}

export const STATUS_LABEL: Record<string, string> = {
  PENDING_PAYMENT: "Awaiting payment",
  PAID: "Paid",
  PROCESSING: "Preparing",
  SHIPPED: "Shipped",
  DELIVERED: "Delivered",
  IN_PROGRESS: "In progress",
  SUBMITTED: "Delivered for review",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
  REFUNDED: "Refunded",
  DISPUTED: "In dispute",
  PARTIALLY_FULFILLED: "Partly delivered",
  FULFILLED: "Delivered",
  IN_TRANSIT: "On the way",
  OUT_FOR_DELIVERY: "Out for delivery",
  DELIVERY_FAILED: "Delivery failed",
  HELD: "Payment held in escrow",
  FROZEN: "Payment on hold",
  RELEASED: "Paid to seller",
};

export function statusLabel(status: string): string {
  return STATUS_LABEL[status] ?? status.toLowerCase().replace(/_/g, " ");
}

/** Markdown descriptions shown as readable plain text. */
export function plainText(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/g, "")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/^#{1,6}\s*/gm, "")
    .replace(/(\*\*|__|\*|_|`)/g, "")
    .replace(/^\s*[-*+]\s+/gm, "• ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
