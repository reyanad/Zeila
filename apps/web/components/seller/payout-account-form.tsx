"use client";

import { useActionState, useState } from "react";
import { Button } from "@marketplace/ui";
import { Field } from "@/components/form/field";
import { FormMessage } from "@/components/form/form-message";
import { SelectField } from "@/components/form/select-field";
import { SubmitButton } from "@/components/form/submit-button";
import { savePayoutAccountAction } from "@/lib/actions/seller";
import { IDLE_FORM_STATE } from "@/lib/form-state";

export interface PayoutBankOption {
  id: number;
  name: string;
  accountLength: number | null;
  isMobileMoney: boolean;
}

export interface SavedPayoutAccount {
  bankName: string;
  accountName: string;
  last4: string;
}

/** Where Chapa sends the seller's earnings: a bank account or a mobile wallet. */
export function PayoutAccountForm({ banks, saved }: { banks: PayoutBankOption[]; saved: SavedPayoutAccount | null }) {
  const [state, action] = useActionState(savePayoutAccountAction, IDLE_FORM_STATE);
  const [editing, setEditing] = useState(saved === null);
  const [bankId, setBankId] = useState(state.values?.bankId ?? "");
  const bank = banks.find((candidate) => String(candidate.id) === bankId);

  if (state.status === "success" || (!editing && saved)) {
    return (
      <div className="flex flex-col gap-3">
        <FormMessage state={state} />
        {saved && state.status !== "success" ? (
          <p className="text-sm">
            Payouts go to <span className="font-medium">{saved.bankName}</span>, {saved.accountName}, ending{" "}
            <span className="font-mono">{saved.last4}</span>.
          </p>
        ) : null}
        <div>
          <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
            Change payout account
          </Button>
        </div>
      </div>
    );
  }

  const options = [
    ...banks.filter((option) => !option.isMobileMoney).map((option) => ({ value: String(option.id), label: option.name })),
    ...banks.filter((option) => option.isMobileMoney).map((option) => ({ value: String(option.id), label: `${option.name} (mobile wallet)` })),
  ];
  const numberLabel = bank?.isMobileMoney ? "Wallet phone number" : "Account number";
  const numberHint = bank?.accountLength ? `${bank.accountLength} digits` : "Digits only";

  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      <FormMessage state={state} />
      <SelectField
        name="bankId"
        label="Bank or mobile wallet"
        options={options}
        placeholder="Choose…"
        required
        value={bankId}
        onChange={(event) => setBankId(event.currentTarget.value)}
        error={state.fields?.bankId}
      />
      <Field
        name="accountName"
        label="Name on the account"
        autoComplete="name"
        required
        defaultValue={state.values?.accountName}
        error={state.fields?.accountName}
        hint="Exactly as your bank or wallet shows it; transfers to a different name may be returned."
      />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field name="accountNumber" label={numberLabel} inputMode="numeric" autoComplete="off" required error={state.fields?.accountNumber} hint={numberHint} />
        <Field name="confirmAccountNumber" label={`Repeat ${numberLabel.toLowerCase()}`} inputMode="numeric" autoComplete="off" required error={state.fields?.confirmAccountNumber} />
      </div>
      <p className="text-xs text-muted-foreground">The number is stored encrypted and only used to send your earnings through Chapa.</p>
      <div className="flex flex-wrap gap-3">
        <SubmitButton pendingLabel="Saving…">Save payout account</SubmitButton>
        {saved ? (
          <Button variant="ghost" onClick={() => setEditing(false)}>
            Cancel
          </Button>
        ) : null}
      </div>
    </form>
  );
}
