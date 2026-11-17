import * as React from "react";
import { cn } from "./cn";

type DivProps = React.HTMLAttributes<HTMLDivElement>;

export function Card({ className, ...rest }: DivProps): React.JSX.Element {
  return <div className={cn("rounded-xl border border-border bg-card text-card-foreground shadow-sm", className)} {...rest} />;
}

export function CardHeader({ className, ...rest }: DivProps): React.JSX.Element {
  return <div className={cn("flex flex-col gap-1.5 p-6", className)} {...rest} />;
}

export function CardTitle({ className, ...rest }: React.HTMLAttributes<HTMLHeadingElement>): React.JSX.Element {
  return <h2 className={cn("text-lg font-semibold leading-tight tracking-tight", className)} {...rest} />;
}

export function CardDescription({ className, ...rest }: React.HTMLAttributes<HTMLParagraphElement>): React.JSX.Element {
  return <p className={cn("text-sm text-muted-foreground", className)} {...rest} />;
}

export function CardContent({ className, ...rest }: DivProps): React.JSX.Element {
  return <div className={cn("p-6 pt-0", className)} {...rest} />;
}

export function CardFooter({ className, ...rest }: DivProps): React.JSX.Element {
  return <div className={cn("flex items-center gap-3 p-6 pt-0", className)} {...rest} />;
}
