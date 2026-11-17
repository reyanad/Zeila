import type { ReactNode } from "react";
import { Input, Label, type InputProps } from "@marketplace/ui";

export interface FieldProps extends Omit<InputProps, "id"> {
  name: string;
  label: string;
  error?: string;
  hint?: ReactNode;
}

/** Labelled input with its hint and validation message wired up for assistive tech. */
export function Field({ name, label, error, hint, ...input }: FieldProps) {
  const describedBy = [hint ? `${name}-hint` : null, error ? `${name}-error` : null].filter(Boolean).join(" ");
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={name}>{label}</Label>
      <Input id={name} name={name} aria-invalid={error ? true : undefined} aria-describedby={describedBy || undefined} {...input} />
      {hint ? (
        <p id={`${name}-hint`} className="text-xs text-muted-foreground">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={`${name}-error`} className="text-xs font-medium text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
