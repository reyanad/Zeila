import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "./cn";

const badgeVariants = cva(
  "inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium whitespace-nowrap",
  {
    variants: {
      tone: {
        neutral: "border-border bg-muted text-muted-foreground",
        success: "border-success/30 bg-success/10 text-success",
        warning: "border-warning/40 bg-warning/15 text-warning-foreground",
        danger: "border-destructive/30 bg-destructive/10 text-destructive",
        info: "border-primary/30 bg-primary/10 text-primary",
      },
    },
    defaultVariants: { tone: "neutral" },
  },
);

export type BadgeTone = NonNullable<VariantProps<typeof badgeVariants>["tone"]>;

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  tone?: BadgeTone;
}

/** Status badge used across order/escrow/dispute/onboarding states. */
export function Badge({ tone = "neutral", className, children, ...rest }: BadgeProps): React.JSX.Element {
  return (
    <span className={cn(badgeVariants({ tone }), className)} {...rest}>
      {children}
    </span>
  );
}
