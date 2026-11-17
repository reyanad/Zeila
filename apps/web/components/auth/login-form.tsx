"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { signIn } from "next-auth/react";
import { Alert, Button } from "@marketplace/ui";
import { Field } from "@/components/form/field";
import { beginLoginAction } from "@/lib/actions/auth";

export interface OAuthProviderOption {
  id: "google" | "github";
  label: string;
}

export interface LoginFormProps {
  callbackUrl: string;
  oauthProviders: OAuthProviderOption[];
  /** Present when an OAuth sign-in already proved the first factor. */
  initialTicket?: string;
}

const SIGN_IN_ERRORS: Record<string, string> = {
  ticket_expired: "Your sign-in attempt timed out. Start again.",
  code_required: "Enter your two-factor code to continue.",
  invalid_code: "That code is not correct. Try again.",
  rate_limited: "Too many incorrect codes. Wait ten minutes and try again.",
  suspended: "This account has been suspended. Contact support for help.",
};

export function LoginForm({ callbackUrl, oauthProviders, initialTicket }: LoginFormProps) {
  const [ticket, setTicket] = useState<string | null>(initialTicket ?? null);
  const [needsCode, setNeedsCode] = useState(Boolean(initialTicket));
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [pending, setPending] = useState(false);

  async function finish(loginTicket: string, code?: string): Promise<void> {
    const result = await signIn("credentials", { ticket: loginTicket, code: code ?? "", redirect: false });
    if (result?.ok && !result.error) {
      // Full navigation so server components render with the new session.
      window.location.assign(callbackUrl);
      return;
    }
    const reason = result?.error ?? "unknown";
    if (reason === "ticket_expired") {
      setTicket(null);
      setNeedsCode(false);
    }
    setError(SIGN_IN_ERRORS[reason] ?? "We could not sign you in. Please try again.");
  }

  async function onPasswordSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setPending(true);
    setError(null);
    setFields({});
    try {
      const result = await beginLoginAction({
        email: String(form.get("email") ?? ""),
        password: String(form.get("password") ?? ""),
      });
      if (result.status === "error") {
        setError(result.message);
        setFields(result.fields ?? {});
        return;
      }
      if (result.twoFactorRequired) {
        setTicket(result.ticket);
        setNeedsCode(true);
        return;
      }
      await finish(result.ticket);
    } catch {
      setError("We could not reach the server. Check your connection and try again.");
    } finally {
      setPending(false);
    }
  }

  async function onCodeSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!ticket) return;
    const code = String(new FormData(event.currentTarget).get("code") ?? "");
    setPending(true);
    setError(null);
    try {
      await finish(ticket, code);
    } catch {
      setError("We could not reach the server. Check your connection and try again.");
    } finally {
      setPending(false);
    }
  }

  if (needsCode && ticket) {
    return (
      <form onSubmit={onCodeSubmit} className="flex flex-col gap-4" noValidate>
        {error ? <Alert tone="danger">{error}</Alert> : null}
        <Field
          name="code"
          label="Two-factor code"
          inputMode="text"
          autoComplete="one-time-code"
          autoFocus
          required
          maxLength={11}
          hint="Enter the 6-digit code from your authenticator app, or one of your recovery codes."
        />
        <Button type="submit" disabled={pending} aria-busy={pending}>
          {pending ? "Verifying…" : "Verify and sign in"}
        </Button>
        <Link href="/login" className="text-center text-sm text-muted-foreground underline-offset-4 hover:underline">
          Use a different account
        </Link>
      </form>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <form onSubmit={onPasswordSubmit} className="flex flex-col gap-4" noValidate>
        {error ? <Alert tone="danger">{error}</Alert> : null}
        <Field name="email" label="Email" type="email" autoComplete="email" required error={fields.email} />
        <Field name="password" label="Password" type="password" autoComplete="current-password" required error={fields.password} />
        <Button type="submit" disabled={pending} aria-busy={pending}>
          {pending ? "Signing in…" : "Sign in"}
        </Button>
        <Link href="/forgot-password" className="text-center text-sm text-muted-foreground underline-offset-4 hover:underline">
          Forgot your password?
        </Link>
      </form>

      {oauthProviders.length > 0 ? (
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-3 text-xs uppercase tracking-wide text-muted-foreground">
            <span className="h-px flex-1 bg-border" />
            or
            <span className="h-px flex-1 bg-border" />
          </div>
          {oauthProviders.map((provider) => (
            <Button key={provider.id} variant="outline" disabled={pending} onClick={() => void signIn(provider.id, { callbackUrl })}>
              Continue with {provider.label}
            </Button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
