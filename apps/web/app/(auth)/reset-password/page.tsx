import type { Metadata } from "next";
import Link from "next/link";
import { Alert, Card, CardContent, CardDescription, CardHeader, CardTitle } from "@marketplace/ui";
import { ResetPasswordForm } from "@/components/auth/password-reset-forms";

export const metadata: Metadata = {
  title: "Choose a new password",
  referrer: "no-referrer",
  robots: { index: false, follow: false },
};
export const dynamic = "force-dynamic";

interface ResetPasswordPageProps {
  searchParams: Promise<{ token?: string }>;
}

export default async function ResetPasswordPage({ searchParams }: ResetPasswordPageProps) {
  const { token } = await searchParams;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Choose a new password</CardTitle>
        <CardDescription>Changing your password signs you out on every device.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {token ? (
          <ResetPasswordForm token={token} />
        ) : (
          <>
            <Alert tone="danger">This reset link is incomplete. Request a new one.</Alert>
            <Link href="/forgot-password" className="text-center text-sm text-primary underline-offset-4 hover:underline">
              Request a new link
            </Link>
          </>
        )}
      </CardContent>
    </Card>
  );
}
