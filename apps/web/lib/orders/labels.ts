import type { BadgeTone } from "@marketplace/ui";

export const ORDER_STATUS: Record<string, { label: string; tone: BadgeTone }> = {
  PENDING_PAYMENT: { label: "Awaiting payment", tone: "warning" },
  PAID: { label: "Paid", tone: "info" },
  PARTIALLY_FULFILLED: { label: "Partly delivered", tone: "info" },
  FULFILLED: { label: "Delivered", tone: "success" },
  COMPLETED: { label: "Completed", tone: "success" },
  CANCELLED: { label: "Cancelled", tone: "neutral" },
  REFUNDED: { label: "Refunded", tone: "neutral" },
};

export const SUB_ORDER_STATUS: Record<string, { label: string; tone: BadgeTone }> = {
  PENDING_PAYMENT: { label: "Awaiting payment", tone: "warning" },
  PAID: { label: "Paid, seller preparing", tone: "info" },
  PROCESSING: { label: "Preparing", tone: "info" },
  SHIPPED: { label: "Shipped", tone: "info" },
  DELIVERED: { label: "Delivered", tone: "success" },
  IN_PROGRESS: { label: "In progress", tone: "info" },
  SUBMITTED: { label: "Delivered for review", tone: "info" },
  COMPLETED: { label: "Completed", tone: "success" },
  CANCELLED: { label: "Cancelled", tone: "neutral" },
  REFUNDED: { label: "Refunded", tone: "neutral" },
  DISPUTED: { label: "In dispute", tone: "danger" },
};
