import type { Metadata } from "next";
import Link from "next/link";
import { buttonVariants, Card, CardContent, CardDescription, CardHeader, CardTitle } from "@marketplace/ui";

export const metadata: Metadata = { title: "Access denied", robots: { index: false, follow: false } };

export default function ForbiddenPage() {
  return (
    <div className="mx-auto w-full max-w-md px-4 py-16">
      <Card>
        <CardHeader>
          <CardTitle>You do not have access to this page</CardTitle>
          <CardDescription>
            Your account does not have the role this area requires. If you think that is a mistake, contact the Zeila team.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex gap-3">
          <Link href="/" className={buttonVariants()}>
            Go to the homepage
          </Link>
          <Link href="/account" className={buttonVariants({ variant: "outline" })}>
            Your account
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}
