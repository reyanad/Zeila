import type { Metadata } from "next";
import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@marketplace/ui";
import { ForgotPasswordForm } from "@/components/auth/password-reset-forms";

export const metadata: Metadata = { title: "Reset your password" };

export default function ForgotPasswordPage() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Reset your password</CardTitle>
        <CardDescription>Enter the email you signed up with and we will send you a link to choose a new password.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <ForgotPasswordForm />
        <Link href="/login" className="text-center text-sm text-muted-foreground underline-offset-4 hover:underline">
          Back to sign in
        </Link>
      </CardContent>
    </Card>
  );
}
