"use client";

import { useFormStatus } from "react-dom";
import { Button, type ButtonProps } from "@marketplace/ui";

export interface SubmitButtonProps extends Omit<ButtonProps, "type"> {
  pendingLabel?: string;
}

/** Submit button that disables itself while the enclosing form action runs. */
export function SubmitButton({ children, pendingLabel = "Working…", disabled, ...rest }: SubmitButtonProps) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending || disabled} aria-busy={pending} {...rest}>
      {pending ? pendingLabel : children}
    </Button>
  );
}
