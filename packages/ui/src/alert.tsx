import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "./cn";

const alertVariants = cva("rounded-lg border px-4 py-3 text-sm", {
  variants: {
    tone: {
      info: "border-primary/30 bg-primary/5 text-foreground",
      success: "border-success/30 bg-success/10 text-foreground",
      warning: "border-warning/40 bg-warning/15 text-foreground",
      danger: "border-destructive/40 bg-destructive/10 text-destructive",
    },
  },
  defaultVariants: { tone: "info" },
});

export type AlertTone = NonNullable<VariantProps<typeof alertVariants>["tone"]>;

export interface AlertProps extends React.HTMLAttributes<HTMLDivElement> {
  tone?: AlertTone;
  title?: string;
}

/** Inline message. Danger alerts are announced assertively to screen readers. */
export function Alert({ tone = "info", title, className, children, ...rest }: AlertProps): React.JSX.Element {
  return (
    <div role={tone === "danger" ? "alert" : "status"} className={cn(alertVariants({ tone }), className)} {...rest}>
      {title ? <p className="mb-1 font-semibold">{title}</p> : null}
      <div>{children}</div>
    </div>
  );
}
