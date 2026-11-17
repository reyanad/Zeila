import type { Metadata } from "next";
import Link from "next/link";
import { ROLE_PERMISSIONS } from "@marketplace/shared-types";
import { Alert, Badge, buttonVariants, Card, CardContent, CardDescription, CardHeader, CardTitle } from "@marketplace/ui";
import { requireUser } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Your account" };

const ROLE_LABELS = {
  BUYER: "Buyer",
  SELLER: "Seller",
  MODERATOR: "Moderator",
  SUPER_ADMIN: "Super admin",
} as const;

export default async function AccountPage() {
  const user = await requireUser("/account");

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>{user.name ?? "Your account"}</CardTitle>
          <CardDescription>{user.email}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <dl className="grid gap-4 text-sm sm:grid-cols-3">
            <div className="flex flex-col gap-1">
              <dt className="text-muted-foreground">Role</dt>
              <dd>
                <Badge tone="info">{ROLE_LABELS[user.role]}</Badge>
              </dd>
            </div>
            <div className="flex flex-col gap-1">
              <dt className="text-muted-foreground">Email</dt>
              <dd>{user.emailVerified ? <Badge tone="success">Confirmed</Badge> : <Badge tone="warning">Not confirmed</Badge>}</dd>
            </div>
            <div className="flex flex-col gap-1">
              <dt className="text-muted-foreground">Two-factor authentication</dt>
              <dd>{user.twoFactorEnabled ? <Badge tone="success">On</Badge> : <Badge tone="neutral">Off</Badge>}</dd>
            </div>
          </dl>
          <p className="text-xs text-muted-foreground">
            Your role grants {ROLE_PERMISSIONS[user.role].size} permissions across buying, selling and moderation.
          </p>
        </CardContent>
      </Card>

      {!user.twoFactorEnabled ? (
        <Alert tone="warning" title="Protect your account">
          Turn on two-factor authentication so a stolen password is not enough to sign in.{" "}
          <Link href="/account/security" className="font-medium underline underline-offset-4">
            Set it up
          </Link>
        </Alert>
      ) : null}

      {user.role === "BUYER" ? (
        <Card>
          <CardHeader>
            <CardTitle>Start selling</CardTitle>
            <CardDescription>Open a store, verify your identity and connect payouts to list products, downloads or services.</CardDescription>
          </CardHeader>
          <CardContent>
            <Link href="/seller/onboarding" className={buttonVariants()}>
              Open a store
            </Link>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>More</CardTitle>
          <CardDescription>Cases, alerts and the referral program.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-3">
          <Link href="/disputes" className={buttonVariants({ variant: "outline", size: "sm" })}>
            Resolution center
          </Link>
          <Link href="/notifications" className={buttonVariants({ variant: "outline", size: "sm" })}>
            Notification settings
          </Link>
          <Link href="/affiliates" className={buttonVariants({ variant: "outline", size: "sm" })}>
            Earn by referring buyers
          </Link>
        </CardContent>
      </Card>
    </>
  );
}
