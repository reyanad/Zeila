"use client";

import { useState } from "react";
import { Button, Input } from "@marketplace/ui";

export function CopyField({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex gap-2">
      <Input aria-label={label} readOnly value={value} onFocus={(event) => event.currentTarget.select()} />
      <Button
        variant="outline"
        onClick={() => {
          void navigator.clipboard
            .writeText(value)
            .then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 2_000);
            })
            .catch(() => setCopied(false));
        }}
      >
        {copied ? "Copied" : "Copy"}
      </Button>
    </div>
  );
}
