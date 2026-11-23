import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import { prisma, type KycStatus, type StoreStatus } from "@marketplace/database";
import { APP_NAME, countryOptions } from "@marketplace/shared-types";
import { Alert, Badge, type BadgeTone, Card, CardContent, CardDescription, CardHeader, CardTitle } from "@marketplace/ui";
import { CreateStoreForm } from "@/components/seller/create-store-form";
import { KycForm } from "@/components/seller/kyc-form";
import { PayoutAccountForm, type PayoutBankOption } from "@/components/seller/payout-account-form";
import { requireUser } from "@/lib/auth/session";
import { getChapa, payoutBanks } from "@/lib/chapa";

export const metadata: Metadata = { title: "Seller setup" };

type StepState = "done" | "review" | "todo" | "locked" | "attention";

const STEP_BADGE: Record<StepState, { tone: BadgeTone; label: string }> = {
  done: { tone: "success", label: "Done" },
  review: { tone: "info", label: "In review" },
  todo: { tone: "warning", label: "To do" },
  locked: { tone: "neutral", label: "Locked" },
  attention: { tone: "danger", label: "Needs attention" },
};

const STORE_STATUS_LABEL: Record<StoreStatus, string> = {
  DRAFT: "Setup in progress",
  PENDING_REVIEW: "Waiting for identity review",
  ACTIVE: "Open for business",
  SUSPENDED: "Suspended",
  CLOSED: "Closed",
};

function Step({ number, title, description, state, children }: {
  number: number;
  title: string;
  description: string;
  state: StepState;
  children: ReactNode;
}) {
  const badge = STEP_BADGE[state];
  return (
    <Card aria-labelledby={`step-${number}`}>
      <CardHeader className="flex flex-row items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <CardTitle id={`step-${number}`}>
            <span className="mr-2 text-muted-foreground">{number}.</span>
            {title}
          </CardTitle>
          <CardDescription>{description}</CardDescription>
        </div>
        <Badge tone={badge.tone}>{badge.label}</Badge>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

function kycState(status: KycStatus | undefined, hasStore: boolean): StepState {
  if (!hasStore) return "locked";
  if (status === "APPROVED") return "done";
  if (status === "PENDING") return "review";
  if (status === "REJECTED") return "attention";
  return "todo";
}

function payoutState(hasAccount: boolean, payoutsEnabled: boolean, hasStore: boolean): StepState {
  if (!hasStore) return "locked";
  if (hasAccount && payoutsEnabled) return "done";
  if (hasAccount) return "attention";
  return "todo";
}

export default async function SellerOnboardingPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireUser("/seller/onboarding");
  const params = await searchParams;

  const [store, kyc] = await Promise.all([
    prisma.store.findUnique({
      where: { sellerId: user.id },
      select: {
        name: true,
        slug: true,
        status: true,
        country: true,
        currency: true,
        payoutBankName: true,
        payoutAccountName: true,
        payoutAccountLast4: true,
        payoutsEnabled: true,
      },
    }),
    prisma.kycSubmission.findFirst({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      select: { status: true, rejectionReason: true, createdAt: true },
    }),
  ]);

  const countries = countryOptions().map((country) => ({ value: country.code, label: country.name }));
  const paymentsConfigured = getChapa() !== null;
  const hasStore = store !== null;
  const identity = kycState(kyc?.status, hasStore);
  const savedAccount =
    store?.payoutBankName && store.payoutAccountName && store.payoutAccountLast4
      ? { bankName: store.payoutBankName, accountName: store.payoutAccountName, last4: store.payoutAccountLast4 }
      : null;
  const payouts = payoutState(savedAccount !== null, store?.payoutsEnabled ?? false, hasStore);
  let banks: PayoutBankOption[] = [];
  let banksProblem = false;
  if (paymentsConfigured && hasStore) {
    try {
      banks = await payoutBanks();
    } catch (error) {
      console.error("[payouts] could not load Chapa banks", error);
      banksProblem = true;
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-10">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">Seller setup</h1>
        <p className="text-sm text-muted-foreground">
          Three steps before you can sell: open your store, verify your identity, and connect a payout account.
          Buyers&apos; payments are held safely until each order is delivered, then paid out to you.
        </p>
      </div>

      {!user.emailVerified ? (
        <Alert tone="warning" title="Confirm your email first">
          We sent a confirmation link when you registered. Open it, then come back to set up your store.
        </Alert>
      ) : null}

      <Step
        number={1}
        title="Open your store"
        description="Your store name and address are public; the country sets where you are paid."
        state={hasStore ? "done" : "todo"}
      >
        {store ? (
          <dl className="grid gap-3 text-sm sm:grid-cols-3">
            <div>
              <dt className="text-muted-foreground">Store</dt>
              <dd className="font-medium">{store.name}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Address</dt>
              <dd className="font-medium">/store/{store.slug}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Status</dt>
              <dd className="font-medium">{STORE_STATUS_LABEL[store.status]}</dd>
            </div>
          </dl>
        ) : (
          <CreateStoreForm countries={countries} />
        )}
      </Step>

      <Step
        number={2}
        title="Verify your identity"
        description="Required by law for anyone who receives payouts. Our team reviews your documents."
        state={identity}
      >
        {identity === "locked" ? (
          <p className="text-sm text-muted-foreground">Open your store first.</p>
        ) : identity === "done" ? (
          <p className="text-sm">Your identity is verified.</p>
        ) : identity === "review" ? (
          <p className="text-sm">
            Submitted on {kyc?.createdAt.toLocaleDateString("en-GB", { dateStyle: "medium" })}. Review usually takes one to
            two business days; we will email you when it is done.
          </p>
        ) : (
          <div className="flex flex-col gap-4">
            {identity === "attention" ? (
              <Alert tone="danger" title="Your last submission was not accepted">
                {kyc?.rejectionReason ?? "The documents could not be verified."} Please submit again.
              </Alert>
            ) : null}
            <KycForm countries={countries} />
          </div>
        )}
      </Step>

      <Step
        number={3}
        title="Add your payout account"
        description="Chapa sends your earnings to your bank account or mobile wallet (telebirr, CBE Birr, M-Pesa) after each order is released."
        state={payouts}
      >
        {payouts === "locked" ? (
          <p className="text-sm text-muted-foreground">Open your store first.</p>
        ) : !paymentsConfigured ? (
          <Alert tone="warning" title="Payouts are not available yet">
            The platform has not finished its Chapa setup. You can complete the other steps now.
          </Alert>
        ) : banksProblem ? (
          <Alert tone="warning" title="Chapa did not answer">
            The list of banks could not be loaded. Reload the page in a minute.
          </Alert>
        ) : (
          <div className="flex flex-col gap-3">
            {payouts === "attention" ? (
              <Alert tone="danger" title="Your last payout could not be sent">
                Check the account details below and save them again. Your earnings stay safe on {APP_NAME} until then.
              </Alert>
            ) : null}
            <PayoutAccountForm banks={banks} saved={payouts === "attention" ? null : savedAccount} />
          </div>
        )}
      </Step>

      {store?.status === "ACTIVE" ? (
        <Alert tone="success" title="You are ready to sell">
          Your store is open.{" "}
          <Link href="/seller/studio" className="font-medium underline underline-offset-4">
            Go to the Vendor Studio
          </Link>
        </Alert>
      ) : store ? (
        <p className="text-sm text-muted-foreground">
          You can start preparing listings while you finish setup.{" "}
          <Link href="/seller/studio" className="font-medium underline underline-offset-4">
            Open the Vendor Studio
          </Link>
        </p>
      ) : null}
    </div>
  );
}
