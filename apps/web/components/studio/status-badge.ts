import type { BadgeTone } from "@marketplace/ui";

export type ListingStatusValue = "DRAFT" | "PENDING_REVIEW" | "ACTIVE" | "PAUSED" | "REJECTED" | "ARCHIVED";

export const STATUS_BADGE: Record<ListingStatusValue, { tone: BadgeTone; label: string }> = {
  DRAFT: { tone: "neutral", label: "Draft" },
  PENDING_REVIEW: { tone: "info", label: "In review" },
  ACTIVE: { tone: "success", label: "Live" },
  PAUSED: { tone: "warning", label: "Paused" },
  REJECTED: { tone: "danger", label: "Rejected" },
  ARCHIVED: { tone: "neutral", label: "Archived" },
};
