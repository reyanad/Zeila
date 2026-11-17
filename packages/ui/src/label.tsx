import * as React from "react";
import { cn } from "./cn";

export type LabelProps = React.LabelHTMLAttributes<HTMLLabelElement>;

export function Label({ className, ...rest }: LabelProps): React.JSX.Element {
  return <label className={cn("text-sm font-medium leading-none", className)} {...rest} />;
}
