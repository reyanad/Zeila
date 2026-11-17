"use client";

import { useActionState, useState } from "react";
import { useRouter } from "next/navigation";
import { Alert, Button } from "@marketplace/ui";
import { Field } from "@/components/form/field";
import { SubmitButton } from "@/components/form/submit-button";
import {
  beginTwoFactorSetupAction,
  confirmTwoFactorSetupAction,
  disableTwoFactorAction,
  regenerateRecoveryCodesAction,
  type TwoFactorState,
} from "@/lib/actions/two-factor";

const IDLE: TwoFactorState = { status: "idle" };

interface SetupDetails {
  secret: string;
  qrDataUrl: string;
}

function RecoveryCodes({ codes }: { codes: string[] }) {
  return (
    <Alert tone="warning" title="Save your recovery codes now">
      <p>
        Each code works once if you lose your phone. They will not be shown again, so store them in a password manager or print them.
      </p>
      <ul className="mt-3 grid grid-cols-2 gap-x-6 gap-y-1 font-mono text-sm">
        {codes.map((code) => (
          <li key={code}>{code}</li>
        ))}
      </ul>
    </Alert>
  );
}

function Message({ state }: { state: TwoFactorState }) {
  if (state.status === "idle" || !state.message) return null;
  return <Alert tone={state.status === "success" ? "success" : "danger"}>{state.message}</Alert>;
}

function EnableFlow() {
  const router = useRouter();
  const [setup, setSetup] = useState<SetupDetails | null>(null);
  const [startError, setStartError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [state, confirm] = useActionState(confirmTwoFactorSetupAction, IDLE);

  async function start(): Promise<void> {
    setStarting(true);
    setStartError(null);
    try {
      const result = await beginTwoFactorSetupAction();
      if (result.ok) setSetup({ secret: result.secret, qrDataUrl: result.qrDataUrl });
      else setStartError(result.message);
    } catch {
      setStartError("We could not reach the server. Try again.");
    } finally {
      setStarting(false);
    }
  }

  if (state.status === "success" && state.recoveryCodes) {
    return (
      <div className="flex flex-col gap-4">
        <Message state={state} />
        <RecoveryCodes codes={state.recoveryCodes} />
        <div>
          <Button onClick={() => router.refresh()}>I have saved my codes</Button>
        </div>
      </div>
    );
  }

  if (!setup) {
    return (
      <div className="flex flex-col gap-3">
        {startError ? <Alert tone="danger">{startError}</Alert> : null}
        <p className="text-sm text-muted-foreground">
          You will need an authenticator app such as Google Authenticator, 1Password or Authy on your phone.
        </p>
        <div>
          <Button onClick={() => void start()} disabled={starting} aria-busy={starting}>
            {starting ? "Preparing…" : "Set up two-factor authentication"}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <ol className="flex list-decimal flex-col gap-2 pl-5 text-sm">
        <li>Open your authenticator app and scan this QR code.</li>
        <li>Enter the 6-digit code the app shows to confirm.</li>
      </ol>
      {/* eslint-disable-next-line @next/next/no-img-element -- data URL generated on the server */}
      <img src={setup.qrDataUrl} alt="QR code for your authenticator app" width={220} height={220} className="rounded-md border border-border bg-white p-2" />
      <p className="text-sm text-muted-foreground">
        Cannot scan? Enter this key manually: <code className="break-all font-mono text-foreground">{setup.secret}</code>
      </p>
      <form action={confirm} className="flex max-w-xs flex-col gap-3" noValidate>
        <Message state={state} />
        <Field name="code" label="6-digit code" inputMode="numeric" autoComplete="one-time-code" maxLength={7} required />
        <div>
          <SubmitButton pendingLabel="Checking…">Turn on</SubmitButton>
        </div>
      </form>
    </div>
  );
}

function ManageFlow() {
  const router = useRouter();
  const [disableState, disable] = useActionState(disableTwoFactorAction, IDLE);
  const [regenState, regenerate] = useActionState(regenerateRecoveryCodesAction, IDLE);

  if (disableState.status === "success") {
    return (
      <div className="flex flex-col gap-3">
        <Message state={disableState} />
        <div>
          <Button variant="outline" onClick={() => router.refresh()}>
            Done
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-8">
      <section className="flex flex-col gap-3">
        <h3 className="text-sm font-semibold">Recovery codes</h3>
        <p className="text-sm text-muted-foreground">Create a fresh set if you have used or lost your codes. The old set stops working.</p>
        <Message state={regenState} />
        {regenState.status === "success" && regenState.recoveryCodes ? <RecoveryCodes codes={regenState.recoveryCodes} /> : null}
        <form action={regenerate} className="flex max-w-xs flex-col gap-3" noValidate>
          <Field name="code" label="Current 6-digit code" inputMode="text" autoComplete="one-time-code" maxLength={11} required />
          <div>
            <SubmitButton variant="outline" pendingLabel="Creating…">
              Create new recovery codes
            </SubmitButton>
          </div>
        </form>
      </section>

      <section className="flex flex-col gap-3">
        <h3 className="text-sm font-semibold">Turn off two-factor authentication</h3>
        <p className="text-sm text-muted-foreground">Your account will be protected by your password alone.</p>
        <Message state={disableState} />
        <form action={disable} className="flex max-w-xs flex-col gap-3" noValidate>
          <Field
            name="code"
            label="6-digit code or recovery code"
            inputMode="text"
            autoComplete="one-time-code"
            maxLength={11}
            required
          />
          <div>
            <SubmitButton variant="destructive" pendingLabel="Turning off…">
              Turn off
            </SubmitButton>
          </div>
        </form>
      </section>
    </div>
  );
}

export function TwoFactorPanel({ enabled }: { enabled: boolean }) {
  return enabled ? <ManageFlow /> : <EnableFlow />;
}
