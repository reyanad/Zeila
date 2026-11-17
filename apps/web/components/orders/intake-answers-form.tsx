"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { IntakeField } from "@marketplace/shared-types";
import { Alert, Button, Input, Label, Select, Textarea } from "@marketplace/ui";
import { saveIntakeAction } from "@/lib/actions/fulfilment";
import { FileUploader, type UploadedFile } from "./file-uploader";

export function IntakeAnswersForm({ orderId, orderItemId, fields, initial }: { orderId: string; orderItemId: string; fields: IntakeField[]; initial: Record<string, string> }) {
  const router = useRouter();
  const [answers, setAnswers] = useState<Record<string, string>>(initial);
  const [files, setFiles] = useState<Record<string, UploadedFile[]>>({});
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [pending, startTransition] = useTransition();

  const set = (id: string, value: string) => setAnswers((current) => ({ ...current, [id]: value }));

  return (
    <div className="flex flex-col gap-4">
      {result ? <Alert tone={result.ok ? "success" : "danger"}>{result.message}</Alert> : null}
      {fields.map((field) => {
        const id = `intake-${field.id}`;
        const label = `${field.label}${field.required ? "" : " (optional)"}`;
        if (field.kind === "file") {
          return <FileUploader key={field.id} orderItemId={orderItemId} label={label} multiple={false} files={files[field.id] ?? []} onChange={(next) => setFiles((current) => ({ ...current, [field.id]: next }))} />;
        }
        return (
          <div key={field.id} className="flex flex-col gap-2">
            <Label htmlFor={id}>{label}</Label>
            {field.kind === "textarea" ? (
              <Textarea id={id} rows={4} maxLength={5000} value={answers[field.id] ?? ""} onChange={(event) => set(field.id, event.currentTarget.value)} />
            ) : field.kind === "select" ? (
              <Select id={id} value={answers[field.id] ?? ""} onChange={(event) => set(field.id, event.currentTarget.value)}>
                <option value="">Choose…</option>
                {field.options.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </Select>
            ) : (
              <Input id={id} type={field.kind === "url" ? "url" : "text"} maxLength={5000} value={answers[field.id] ?? ""} onChange={(event) => set(field.id, event.currentTarget.value)} />
            )}
          </div>
        );
      })}
      <div>
        <Button
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              const tokens = Object.fromEntries(Object.entries(files).flatMap(([fieldId, list]) => (list[0] ? [[fieldId, list[0].token]] : [])));
              const response = await saveIntakeAction(orderId, orderItemId, answers, tokens);
              setResult(response.ok ? { ok: true, message: response.message ?? "Saved." } : { ok: false, message: response.message });
              if (response.ok) router.refresh();
            })
          }
        >
          {pending ? "Sending…" : "Send answers"}
        </Button>
      </div>
    </div>
  );
}
