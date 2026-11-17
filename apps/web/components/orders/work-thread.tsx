import { attachmentHref, type WorkView } from "@/lib/orders/work";

function sizeLabel(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

const when = (date: Date) => date.toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" });

/** Read-only view of a service item's brief, deliveries and revision rounds, shared by buyer and seller. */
export function WorkThread({ work, viewer }: { work: WorkView; viewer: "buyer" | "seller" }) {
  return (
    <div className="flex flex-col gap-4 text-sm">
      {work.fields.length > 0 ? (
        <section className="flex flex-col gap-2 rounded-md border border-border p-3" aria-label="Brief">
          <h3 className="font-medium">Brief from the buyer</h3>
          {work.answers ? (
            <dl className="flex flex-col gap-2">
              {work.answers.map((answer) => (
                <div key={answer.field.id}>
                  <dt className="text-xs text-muted-foreground">{answer.field.label}</dt>
                  <dd className="whitespace-pre-wrap">
                    {answer.file ? (
                      <a className="underline underline-offset-4" href={attachmentHref(work.orderItemId, answer.file)}>
                        {answer.file.fileName} ({sizeLabel(answer.file.sizeBytes)})
                      </a>
                    ) : (
                      answer.text ?? <span className="text-muted-foreground">No answer</span>
                    )}
                  </dd>
                </div>
              ))}
            </dl>
          ) : (
            <p className="text-muted-foreground">{viewer === "seller" ? "The buyer has not answered your questions yet." : "Answer the seller's questions below so they can start."}</p>
          )}
        </section>
      ) : null}

      {work.timeline.length === 0 ? (
        <p className="text-muted-foreground">Nothing has been delivered yet{work.dueAt ? `; due ${work.dueAt.toLocaleDateString("en-GB", { dateStyle: "medium" })}` : ""}.</p>
      ) : (
        <ol className="flex flex-col gap-3">
          {work.timeline.map((entry, index) =>
            entry.kind === "delivery" ? (
              <li key={`d-${index}`} className="rounded-md bg-muted/60 p-3">
                <p className="text-xs text-muted-foreground">Delivered {when(entry.at)}</p>
                {entry.message ? <p className="mt-1 whitespace-pre-wrap">{entry.message}</p> : null}
                {entry.files.length > 0 ? (
                  <ul className="mt-2 flex flex-col gap-1">
                    {entry.files.map((file) => (
                      <li key={file.key}>
                        <a className="underline underline-offset-4" href={attachmentHref(work.orderItemId, file)}>
                          {file.fileName}
                        </a>{" "}
                        <span className="text-xs text-muted-foreground">{sizeLabel(file.sizeBytes)}</span>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </li>
            ) : (
              <li key={`r-${index}`} className="rounded-md border border-border p-3">
                <p className="text-xs text-muted-foreground">Changes requested {when(entry.at)}</p>
                <p className="mt-1 whitespace-pre-wrap">{entry.note}</p>
              </li>
            ),
          )}
        </ol>
      )}
      <p className="text-xs text-muted-foreground">
        Revision rounds: {work.revisionsAllowed < 0 ? `${work.revisionsUsed} used (unlimited)` : `${work.revisionsUsed} of ${work.revisionsAllowed} used`}
      </p>
    </div>
  );
}
