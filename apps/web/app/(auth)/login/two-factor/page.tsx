import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@marketplace/ui";
import { LoginForm } from "@/components/auth/login-form";

export const metadata: Metadata = {
  title: "Two-factor verification",
  // The ticket travels in the query string; never leak it through Referer.
  referrer: "no-referrer",
  robots: { index: false, follow: false },
};
export const dynamic = "force-dynamic";

interface TwoFactorPageProps {
  searchParams: Promise<{ ticket?: string }>;
}

/** Second step after an OAuth sign-in for accounts with two-factor enabled. */
export default async function TwoFactorPage({ searchParams }: TwoFactorPageProps) {
  const { ticket } = await searchParams;
  if (!ticket) redirect("/login");

  return (
    <Card>
      <CardHeader>
        <CardTitle>Two-factor verification</CardTitle>
        <CardDescription>Your account is protected with an authenticator app. Enter a code to finish signing in.</CardDescription>
      </CardHeader>
      <CardContent>
        <LoginForm callbackUrl="/account" oauthProviders={[]} initialTicket={ticket} />
      </CardContent>
    </Card>
  );
}
