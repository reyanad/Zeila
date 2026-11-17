"use client";

import { useId, useState } from "react";
import { Button, Input, Label } from "@marketplace/ui";

export interface UploadedFile {
  token: string;
  fileName: string;
  sizeBytes: number;
}

function upload(endpoint: string, file: File, onProgress: (fraction: number) => void): Promise<UploadedFile> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("POST", endpoint);
    request.setRequestHeader("X-File-Name", encodeURIComponent(file.name));
    request.setRequestHeader("Content-Type", "application/octet-stream");
    request.upload.onprogress = (event) => event.lengthComputable && onProgress(event.loaded / event.total);
    request.onerror = () => reject(new Error("The connection dropped."));
    request.onload = () => {
      try {
        const body = JSON.parse(request.responseText) as { token?: string; fileName?: string; sizeBytes?: number; error?: string };
        if (request.status === 200 && body.token && body.fileName && body.sizeBytes) resolve({ token: body.token, fileName: body.fileName, sizeBytes: body.sizeBytes });
        else reject(new Error(body.error ?? "The upload did not finish."));
      } catch {
        reject(new Error("The upload did not finish."));
      }
    };
    request.send(file);
  });
}

/**
 * Uploads files (encrypted in the vault) and reports their signed tokens.
 * Pass `orderItemId` for order files or `endpoint` for another upload route.
 */
export function FileUploader({ orderItemId, endpoint, label, files, onChange, multiple = true }: {
  orderItemId?: string;
  endpoint?: string;
  label: string;
  files: UploadedFile[];
  onChange: (files: UploadedFile[]) => void;
  multiple?: boolean;
}) {
  const id = useId();
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const start = async (list: FileList) => {
    setError(null);
    const added: UploadedFile[] = [];
    for (const file of Array.from(list).slice(0, multiple ? 10 : 1)) {
      setProgress(0);
      try {
        added.push(await upload(endpoint ?? `/api/orders/${orderItemId ?? ""}/files`, file, setProgress));
      } catch (uploadError) {
        setError(`${file.name}: ${uploadError instanceof Error ? uploadError.message : "failed"}`);
        break;
      }
    }
    setProgress(null);
    onChange(multiple ? [...files, ...added] : added.slice(0, 1));
  };

  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={id}>{label}</Label>
      {files.length > 0 ? (
        <ul className="flex flex-col gap-1 text-sm">
          {files.map((file) => (
            <li key={file.token} className="flex items-center justify-between gap-2 rounded bg-muted/60 px-2 py-1">
              <span className="truncate">{file.fileName}</span>
              <Button size="sm" variant="ghost" onClick={() => onChange(files.filter((candidate) => candidate.token !== file.token))}>
                Remove
              </Button>
            </li>
          ))}
        </ul>
      ) : null}
      {progress !== null ? (
        <progress className="w-full" max={1} value={progress} aria-label="Upload progress" />
      ) : (
        <Input
          id={id}
          type="file"
          multiple={multiple}
          onChange={(event) => {
            const input = event.currentTarget;
            const selected = input.files;
            if (selected && selected.length > 0) void start(selected).finally(() => (input.value = ""));
          }}
        />
      )}
      {error ? <p className="text-xs font-medium text-destructive">{error}</p> : null}
    </div>
  );
}
