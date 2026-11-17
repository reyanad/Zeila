"use client";

import { useId, useState } from "react";
import type { DigitalAssetRef } from "@marketplace/shared-types";
import { Alert, Button, Input, Label } from "@marketplace/ui";
import { FieldError, TextAreaField, TextField, useBuilder } from "./builder-context";

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value < 10 ? 1 : 0)} ${units[unit]}`;
}

interface UploadResponse extends DigitalAssetRef {
  error?: string;
}

/** Streams the file to the vault with progress (fetch cannot report upload progress). */
function uploadFile(file: File, onProgress: (fraction: number) => void): Promise<DigitalAssetRef> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("POST", "/api/studio/uploads/digital");
    request.setRequestHeader("X-File-Name", encodeURIComponent(file.name));
    request.setRequestHeader("Content-Type", "application/octet-stream");
    request.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(event.loaded / event.total);
    };
    request.onerror = () => reject(new Error("The connection dropped. Try again."));
    request.onload = () => {
      let body: Partial<UploadResponse> = {};
      try {
        body = JSON.parse(request.responseText) as Partial<UploadResponse>;
      } catch {
        reject(new Error("The upload did not finish. Try again."));
        return;
      }
      if (request.status !== 200 || !body.vaultKey || !body.fileName || !body.sizeBytes || !body.checksumSha256) {
        reject(new Error(body.error ?? "The upload did not finish. Try again."));
        return;
      }
      resolve({
        vaultKey: body.vaultKey,
        fileName: body.fileName,
        sizeBytes: body.sizeBytes,
        checksumSha256: body.checksumSha256,
        token: body.token ?? null,
      });
    };
    request.send(file);
  });
}

export function DigitalEditor({ currency }: { currency: string }) {
  const digital = useBuilder((state) => state.draft.digital);
  const errors = useBuilder((state) => state.errors);
  const update = useBuilder((state) => state.updateDigital);
  const [progress, setProgress] = useState<number | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileId = useId();

  const start = async (file: File) => {
    setUploadError(null);
    setProgress(0);
    try {
      const asset = await uploadFile(file, setProgress);
      update({ asset });
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : "The upload failed.");
    } finally {
      setProgress(null);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-3" aria-labelledby="file-heading">
        <h3 id="file-heading" className="font-medium">
          File
        </h3>
        {digital.asset ? (
          <div className="rounded-md border border-border p-3 text-sm">
            <p className="font-medium">{digital.asset.fileName}</p>
            <p className="text-muted-foreground">
              {formatBytes(digital.asset.sizeBytes)} · SHA-256 {digital.asset.checksumSha256.slice(0, 12)}… · encrypted in the vault
            </p>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">Upload the file buyers receive. It is encrypted and only released after payment.</p>
        )}
        <FieldError id="asset-error" message={errors.asset} />
        {uploadError ? <Alert tone="danger">{uploadError}</Alert> : null}
        {progress !== null ? (
          <div className="flex flex-col gap-1" role="status" aria-live="polite">
            <progress className="w-full" max={1} value={progress} />
            <span className="text-xs text-muted-foreground">Uploading… {Math.round(progress * 100)}%</span>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            <Label htmlFor={fileId}>{digital.asset ? "Replace the file" : "Choose a file"}</Label>
            <Input
              id={fileId}
              type="file"
              onChange={(event) => {
                const input = event.currentTarget;
                const file = input.files?.[0];
                input.value = "";
                if (file) void start(file);
              }}
            />
          </div>
        )}
      </section>

      <div className="grid gap-4 sm:grid-cols-2">
        <TextField
          id="digital-price"
          label={`Price (${currency})`}
          inputMode="decimal"
          value={digital.price}
          onChange={(event) => update({ price: event.currentTarget.value })}
          error={errors.price}
          hint="Use 0 for a free download."
        />
        <TextField
          id="digital-version"
          label="Version"
          value={digital.version}
          maxLength={20}
          onChange={(event) => update({ version: event.currentTarget.value })}
          error={errors.version}
        />
      </div>
      <TextAreaField
        id="digital-changelog"
        label="What's new in this version (optional)"
        value={digital.changelog}
        maxLength={5000}
        onChange={(event) => update({ changelog: event.currentTarget.value })}
        error={errors.changelog}
      />

      <section className="flex flex-col gap-4" aria-labelledby="licence-heading">
        <h3 id="licence-heading" className="font-medium">
          Licence keys and downloads
        </h3>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="h-4 w-4"
            checked={digital.licenseKeys}
            onChange={(event) => update({ licenseKeys: event.currentTarget.checked })}
          />
          Issue a licence key with every purchase
        </label>
        <div className="grid gap-4 sm:grid-cols-3">
          {digital.licenseKeys ? (
            <>
              <TextField
                id="licence-prefix"
                label="Key prefix (optional)"
                placeholder="ZEILA"
                maxLength={10}
                value={digital.licensePrefix}
                onChange={(event) => update({ licensePrefix: event.currentTarget.value.toUpperCase() })}
                error={errors.licensePrefix}
              />
              <TextField
                id="licence-activations"
                label="Devices per key"
                inputMode="numeric"
                value={digital.activationsLimit}
                onChange={(event) => update({ activationsLimit: event.currentTarget.value })}
                error={errors.activationsLimit}
              />
            </>
          ) : null}
          <TextField
            id="download-limit"
            label="Downloads per purchase"
            inputMode="numeric"
            placeholder="Unlimited"
            value={digital.downloadLimit}
            onChange={(event) => update({ downloadLimit: event.currentTarget.value })}
            error={errors.downloadLimit}
          />
        </div>
      </section>
      {digital.asset && progress === null ? (
        <div>
          <Button variant="ghost" size="sm" onClick={() => update({ asset: null })}>
            Remove file
          </Button>
        </div>
      ) : null}
    </div>
  );
}
