import type { ReactNode } from "react";
import { Label, Select, type SelectProps } from "@marketplace/ui";

export interface SelectOption {
  value: string;
  label: string;
}

export interface SelectFieldProps extends Omit<SelectProps, "id" | "children"> {
  name: string;
  label: string;
  options: readonly SelectOption[];
  placeholder?: string;
  error?: string;
  hint?: ReactNode;
}

/** Labelled native select with hint and validation message, matching `Field`. */
export function SelectField({ name, label, options, placeholder, error, hint, ...select }: SelectFieldProps) {
  const describedBy = [hint ? `${name}-hint` : null, error ? `${name}-error` : null].filter(Boolean).join(" ");
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={name}>{label}</Label>
      <Select id={name} name={name} aria-invalid={error ? true : undefined} aria-describedby={describedBy || undefined} {...select}>
        {placeholder ? <option value="">{placeholder}</option> : null}
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </Select>
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
