"use client";

import { createContext, useContext, type ReactNode } from "react";
import { useStore } from "zustand";
import { Input, Label, Textarea, type InputProps, type TextareaProps } from "@marketplace/ui";
import type { BuilderState, BuilderStore } from "./builder-store";

export const BuilderContext = createContext<BuilderStore | null>(null);

export function useBuilderStore(): BuilderStore {
  const store = useContext(BuilderContext);
  if (!store) throw new Error("useBuilder must be used inside <ListingBuilder>");
  return store;
}

/** Subscribe to a slice of builder state. Selectors must return stable references. */
export function useBuilder<T>(selector: (state: BuilderState) => T): T {
  return useStore(useBuilderStore(), selector);
}

export function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) return null;
  return (
    <p id={id} className="text-xs font-medium text-destructive">
      {message}
    </p>
  );
}

interface LabelledProps {
  id: string;
  label: string;
  error?: string;
  hint?: ReactNode;
}

export function TextField({ id, label, error, hint, ...input }: LabelledProps & Omit<InputProps, "id">) {
  const describedBy = [hint ? `${id}-hint` : null, error ? `${id}-error` : null].filter(Boolean).join(" ");
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} aria-invalid={error ? true : undefined} aria-describedby={describedBy || undefined} {...input} />
      {hint ? (
        <p id={`${id}-hint`} className="text-xs text-muted-foreground">
          {hint}
        </p>
      ) : null}
      <FieldError id={`${id}-error`} message={error} />
    </div>
  );
}

export function TextAreaField({ id, label, error, hint, ...textarea }: LabelledProps & Omit<TextareaProps, "id">) {
  const describedBy = [hint ? `${id}-hint` : null, error ? `${id}-error` : null].filter(Boolean).join(" ");
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={id}>{label}</Label>
      <Textarea id={id} aria-invalid={error ? true : undefined} aria-describedby={describedBy || undefined} {...textarea} />
      {hint ? (
        <p id={`${id}-hint`} className="text-xs text-muted-foreground">
          {hint}
        </p>
      ) : null}
      <FieldError id={`${id}-error`} message={error} />
    </div>
  );
}
