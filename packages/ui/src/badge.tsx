import * as React from "react";
import { cn } from "./cn";

export type BadgeTone = "neutral" | "success" | "warning" | "danger" | "info";

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  tone?: BadgeTone;
}

const TONE_CLASSES: Record<BadgeTone, string> = {
  neutral: "mp-badge--neutral",
  success: "mp-badge--success",
  warning: "mp-badge--warning",
  danger: "mp-badge--danger",
  info: "mp-badge--info",
};

/**
 * Minimal status badge used across order/escrow/dispute states.
 * Styling hooks are plain class names until the Tailwind design system
 * arrives in Phase 3; the component API stays stable.
 */
export function Badge({ tone = "neutral", className, children, ...rest }: BadgeProps): React.JSX.Element {
  return (
    <span className={cn("mp-badge", TONE_CLASSES[tone], className)} {...rest}>
      {children}
    </span>
  );
}
