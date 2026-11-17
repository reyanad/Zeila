import type { Metadata } from "next";
import Link from "next/link";
import { Alert, Card, CardContent, CardDescription, CardHeader, CardTitle } from "@marketplace/ui";
import { LoginForm } from "@/components/auth/login-form";
import { enabledOAuthProviders } from "@/lib/auth/options";
import { safeRedirectPath } from "@/lib/request";

export const metadata: Metadata = { title: "Sign in" };
export const dynamic = "force-dynamic";

const ERROR_MESSAGES: Record<string, string> = {
  OAuthEmailMissing: "That provider did not share an email address with us. Make your email available to it and try again.",
  OAuthEmailUnverified: "Verify your email address with that provider first, then try again.",
  AccountSuspended: "This account has been suspended. Contact support for help.",
  OAuthAccountNotLinked: "That email is already registered with a different sign-in method. Use the original method.",
  OAuthSignin: "We could not start the sign-in with that provider. Please try again.",
  OAuthCallback: "The sign-in with that provider did not complete. Please try again.",
  AccessDenied: "Access was denied. Please try again.",
  VerificationExpired: "That confirmation link has expired or was already used. Sign in to get a new one.",
};

const NOTICES: Record<string, string> = {
  verified: "Your email address is confirmed. You can sign in now.",
};

interface LoginPageProps {
  searchParams: Promise<{ callbackUrl?: string; error?: string; notice?: string }>;
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const params = await searchParams;
  const callbackUrl = safeRedirectPath(params.callbackUrl);
  const errorMessage = params.error ? (ERROR_MESSAGES[params.error] ?? "We could not sign you in. Please try again.") : null;
  const notice = params.notice ? NOTICES[params.notice] : undefined;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Sign in</CardTitle>
        <CardDescription>Welcome back. Sign in to buy, sell and manage your orders.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {notice ? <Alert tone="success">{notice}</Alert> : null}
        {errorMessage ? <Alert tone="danger">{errorMessage}</Alert> : null}
        <LoginForm callbackUrl={callbackUrl} oauthProviders={enabledOAuthProviders()} />
        <p className="text-center text-sm text-muted-foreground">
          New here?{" "}
          <Link href="/register" className="font-medium text-primary underline-offset-4 hover:underline">
            Create an account
          </Link>
        </p>
      </CardContent>
    </Card>
  );
}
