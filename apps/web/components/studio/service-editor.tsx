"use client";

import { INTAKE_FIELD_KINDS, LISTING_LIMITS, SERVICE_TIER_LEVELS, type IntakeFieldKind } from "@marketplace/shared-types";
import { Button, Card, CardContent, CardHeader, CardTitle, Label, Select } from "@marketplace/ui";
import { FieldError, TextAreaField, TextField, useBuilder } from "./builder-context";
import { uid, type IntakeDraft } from "./builder-store";

const LEVEL_LABELS = { BASIC: "Basic", STANDARD: "Standard", PREMIUM: "Premium" } as const;
const KIND_LABELS: Record<IntakeFieldKind, string> = {
  text: "Short answer",
  textarea: "Long answer",
  select: "Choice",
  file: "File upload",
  url: "Link",
};

export function ServiceEditor({ currency }: { currency: string }) {
  const service = useBuilder((state) => state.draft.service);
  const intake = useBuilder((state) => state.draft.intake);
  const errors = useBuilder((state) => state.errors);
  const updateTier = useBuilder((state) => state.updateTier);
  const set = useBuilder((state) => state.set);

  const editQuestion = (questionUid: string, patch: Partial<IntakeDraft>) =>
    set("intake", intake.map((question) => (question.uid === questionUid ? { ...question, ...patch } : question)));

  return (
    <div className="flex flex-col gap-8">
      <section className="flex flex-col gap-4" aria-labelledby="packages-heading">
        <div>
          <h3 id="packages-heading" className="font-medium">
            Packages
          </h3>
          <p className="text-sm text-muted-foreground">
            Offer up to three packages. Buyers pay into escrow; you are paid when they approve the delivery.
          </p>
        </div>
        <FieldError id="tiers-error" message={errors.tiers} />
        <div className="grid gap-4 lg:grid-cols-3">
          {SERVICE_TIER_LEVELS.map((level) => {
            const tier = service[level];
            const key = (field: string) => errors[`service.${level}.${field}`];
            return (
              <Card key={level} className={tier.enabled ? "" : "opacity-60"}>
                <CardHeader className="flex flex-row items-center justify-between gap-2 p-4">
                  <CardTitle className="text-base">{LEVEL_LABELS[level]}</CardTitle>
                  {level === "BASIC" ? (
                    <span className="text-xs text-muted-foreground">Required</span>
                  ) : (
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        className="h-4 w-4"
                        checked={tier.enabled}
                        onChange={(event) => updateTier(level, { enabled: event.currentTarget.checked })}
                      />
                      Offer
                    </label>
                  )}
                </CardHeader>
                {tier.enabled ? (
                  <CardContent className="flex flex-col gap-3 p-4 pt-0">
                    <TextField id={`${level}-title`} label="Package name" value={tier.title} maxLength={60} onChange={(event) => updateTier(level, { title: event.currentTarget.value })} error={key("title")} />
                    <TextAreaField id={`${level}-description`} label="What's included" rows={3} value={tier.description} maxLength={600} onChange={(event) => updateTier(level, { description: event.currentTarget.value })} error={key("description")} />
                    <TextField id={`${level}-price`} label={`Price (${currency})`} inputMode="decimal" value={tier.price} onChange={(event) => updateTier(level, { price: event.currentTarget.value })} error={key("price")} />
                    <div className="grid grid-cols-2 gap-3">
                      <TextField id={`${level}-days`} label="Delivery (days)" inputMode="numeric" value={tier.deliveryDays} onChange={(event) => updateTier(level, { deliveryDays: event.currentTarget.value })} error={key("deliveryDays")} />
                      <TextField
                        id={`${level}-revisions`}
                        label="Revisions"
                        inputMode="numeric"
                        disabled={tier.unlimitedRevisions}
                        value={tier.unlimitedRevisions ? "∞" : tier.revisions}
                        onChange={(event) => updateTier(level, { revisions: event.currentTarget.value })}
                        error={key("revisions")}
                      />
                    </div>
                    <label className="flex items-center gap-2 text-sm">
                      <input type="checkbox" className="h-4 w-4" checked={tier.unlimitedRevisions} onChange={(event) => updateTier(level, { unlimitedRevisions: event.currentTarget.checked })} />
                      Unlimited revisions
                    </label>
                    <TextAreaField
                      id={`${level}-features`}
                      label="Features (one per line)"
                      rows={3}
                      value={tier.featuresText}
                      onChange={(event) => updateTier(level, { featuresText: event.currentTarget.value })}
                      error={key("features")}
                      hint={`Up to ${LISTING_LIMITS.serviceFeaturesMax}.`}
                    />
                  </CardContent>
                ) : null}
              </Card>
            );
          })}
        </div>
      </section>

      <section className="flex flex-col gap-4" aria-labelledby="intake-heading">
        <div>
          <h3 id="intake-heading" className="font-medium">
            Questions for the buyer (optional)
          </h3>
          <p className="text-sm text-muted-foreground">Buyers answer these right after ordering, so you can start without waiting.</p>
        </div>
        <FieldError id="intake-error" message={errors.intakeFields} />
        {intake.map((question, index) => (
          <div key={question.uid} className="flex flex-col gap-3 rounded-md border border-border p-3">
            <div className="grid gap-3 sm:grid-cols-[1fr_10rem] sm:items-end">
              <TextField
                id={`q-${question.uid}-label`}
                label={`Question ${index + 1}`}
                value={question.label}
                maxLength={200}
                onChange={(event) => editQuestion(question.uid, { label: event.currentTarget.value })}
                error={errors[`intakeFields.${index}.label`]}
              />
              <div className="flex flex-col gap-2">
                <Label htmlFor={`q-${question.uid}-kind`}>Answer type</Label>
                <Select
                  id={`q-${question.uid}-kind`}
                  value={question.kind}
                  onChange={(event) => editQuestion(question.uid, { kind: event.currentTarget.value as IntakeFieldKind })}
                >
                  {INTAKE_FIELD_KINDS.map((kind) => (
                    <option key={kind} value={kind}>
                      {KIND_LABELS[kind]}
                    </option>
                  ))}
                </Select>
              </div>
            </div>
            {question.kind === "select" ? (
              <TextAreaField
                id={`q-${question.uid}-options`}
                label="Choices (one per line)"
                rows={3}
                value={question.optionsText}
                onChange={(event) => editQuestion(question.uid, { optionsText: event.currentTarget.value })}
                error={errors[`intakeFields.${index}.options`]}
              />
            ) : null}
            <div className="flex items-center justify-between">
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" className="h-4 w-4" checked={question.required} onChange={(event) => editQuestion(question.uid, { required: event.currentTarget.checked })} />
                Required
              </label>
              <Button variant="ghost" size="sm" onClick={() => set("intake", intake.filter((item) => item.uid !== question.uid))}>
                Remove
              </Button>
            </div>
          </div>
        ))}
        {intake.length < LISTING_LIMITS.intakeFieldsMax ? (
          <div>
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                set("intake", [...intake, { uid: uid(), id: `q-${uid()}`, label: "", kind: "text", required: true, optionsText: "" }])
              }
            >
              Add question
            </Button>
          </div>
        ) : null}
      </section>
    </div>
  );
}
