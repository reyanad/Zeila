import type { Metadata } from "next";
import { prisma } from "@marketplace/database";
import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle } from "@marketplace/ui";
import { ChangePasswordForm } from "@/components/account/change-password-form";
import { TwoFactorPanel } from "@/components/account/two-factor-panel";
import { requireUser } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Security" };

const PROVIDER_LABELS: Record<string, string> = { google: "Google", github: "GitHub" };

export default async function SecurityPage() {
  const user = await requireUser("/account/security");
  const [linkedAccounts, unusedRecoveryCodes] = await Promise.all([
    prisma.oauthAccount.findMany({ where: { userId: user.id }, select: { provider: true }, orderBy: { provider: "asc" } }),
    user.twoFactorEnabled ? prisma.twoFactorRecoveryCode.count({ where: { userId: user.id, usedAt: null } }) : Promise.resolve(0),
  ]);

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-3">
            Two-factor authentication
            {user.twoFactorEnabled ? <Badge tone="success">On</Badge> : <Badge tone="neutral">Off</Badge>}
          </CardTitle>
          <CardDescription>
            {user.twoFactorEnabled
              ? `Signing in requires a code from your authenticator app. You have ${unusedRecoveryCodes} unused recovery ${unusedRecoveryCodes === 1 ? "code" : "codes"}.`
              : "Require a code from your phone as well as your password when signing in."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <TwoFactorPanel enabled={user.twoFactorEnabled} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Password</CardTitle>
          <CardDescription>
            {user.hasPassword
              ? "Changing your password signs you out on every device."
              : "You sign in with a connected account. Set a password to be able to sign in with your email as well."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ChangePasswordForm hasPassword={user.hasPassword} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Connected sign-in methods</CardTitle>
          <CardDescription>Accounts you can use to sign in without your password.</CardDescription>
        </CardHeader>
        <CardContent>
          {linkedAccounts.length === 0 ? (
            <p className="text-sm text-muted-foreground">None connected. Choose Google or GitHub on the sign-in page to connect one.</p>
          ) : (
            <ul className="flex flex-wrap gap-2">
              {linkedAccounts.map((account) => (
                <li key={account.provider}>
                  <Badge tone="info">{PROVIDER_LABELS[account.provider] ?? account.provider}</Badge>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </>
  );
}
