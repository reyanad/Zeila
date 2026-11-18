-- Switch payments from Stripe to Chapa.
-- Sellers are paid by Chapa transfers to a bank account or mobile wallet, so
-- the Stripe Connect fields on Store are replaced by payout account details,
-- and every Stripe-named reference becomes provider-neutral.

-- CreateEnum
CREATE TYPE "RefundStatus" AS ENUM ('REQUESTED', 'PROCESSING', 'REFUNDED', 'REVERSED', 'FAILED');

-- Store: Stripe Connect account -> payout account
DROP INDEX "Store_stripeAccountId_key";
ALTER TABLE "Store" DROP COLUMN "stripeAccountId",
DROP COLUMN "stripeOnboarding",
DROP COLUMN "chargesEnabled",
ADD COLUMN     "payoutBankId" INTEGER,
ADD COLUMN     "payoutBankName" TEXT,
ADD COLUMN     "payoutAccountName" TEXT,
ADD COLUMN     "payoutAccountNumber" TEXT,
ADD COLUMN     "payoutAccountLast4" TEXT,
ADD COLUMN     "payoutAccountUpdatedAt" TIMESTAMP(3);

-- Stores need a new payout account before they can be paid again.
UPDATE "Store" SET "payoutsEnabled" = false;

DROP TYPE "StripeOnboardingStatus";

-- Payment: PaymentIntent id -> Chapa tx_ref
ALTER TABLE "Payment" RENAME COLUMN "stripePaymentIntentId" TO "providerRef";
ALTER TABLE "Payment" RENAME COLUMN "stripeChargeId" TO "providerReference";
ALTER INDEX "Payment_stripePaymentIntentId_key" RENAME TO "Payment_providerRef_key";
ALTER TABLE "Payment" ADD COLUMN     "provider" TEXT NOT NULL DEFAULT 'chapa',
ADD COLUMN     "method" TEXT,
ADD COLUMN     "checkoutUrl" TEXT;
UPDATE "Payment" SET "provider" = 'stripe';

-- Refund: Stripe refund id -> our reference, plus the provider's id and state
ALTER TABLE "Refund" RENAME COLUMN "stripeRefundId" TO "reference";
ALTER INDEX "Refund_stripeRefundId_key" RENAME TO "Refund_reference_key";
ALTER TABLE "Refund" ADD COLUMN     "requestReference" TEXT,
ADD COLUMN     "providerRefundId" TEXT,
ADD COLUMN     "status" "RefundStatus" NOT NULL DEFAULT 'REQUESTED',
ADD COLUMN     "failureReason" TEXT,
ADD COLUMN     "updatedAt" TIMESTAMP(3);
UPDATE "Refund" SET "requestReference" = "reference", "providerRefundId" = "reference", "status" = 'REFUNDED', "updatedAt" = "createdAt";
ALTER TABLE "Refund" ALTER COLUMN "requestReference" SET NOT NULL,
ALTER COLUMN "updatedAt" SET NOT NULL;
CREATE UNIQUE INDEX "Refund_providerRefundId_key" ON "Refund"("providerRefundId");
CREATE INDEX "Refund_status_idx" ON "Refund"("status");

-- Payout: one Chapa transfer to a store's account
ALTER TABLE "Payout" RENAME COLUMN "stripePayoutId" TO "providerTransferId";
ALTER INDEX "Payout_stripePayoutId_key" RENAME TO "Payout_providerTransferId_key";
ALTER TABLE "Payout" ADD COLUMN     "reference" TEXT,
ADD COLUMN     "bankName" TEXT,
ADD COLUMN     "accountLast4" TEXT,
ADD COLUMN     "paidAt" TIMESTAMP(3);
UPDATE "Payout" SET "reference" = "id";
ALTER TABLE "Payout" ALTER COLUMN "reference" SET NOT NULL;
CREATE UNIQUE INDEX "Payout_reference_key" ON "Payout"("reference");

-- Escrow: Stripe transfer id -> the payout that paid it
DROP INDEX "Escrow_stripeTransferId_key";
ALTER TABLE "Escrow" DROP COLUMN "stripeTransferId",
ADD COLUMN     "payoutId" TEXT;
CREATE INDEX "Escrow_payoutId_idx" ON "Escrow"("payoutId");
ALTER TABLE "Escrow" ADD CONSTRAINT "Escrow_payoutId_fkey" FOREIGN KEY ("payoutId") REFERENCES "Payout"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Dispute: Stripe dispute id -> provider case id
ALTER TABLE "Dispute" RENAME COLUMN "stripeDisputeId" TO "providerCaseId";
ALTER INDEX "Dispute_stripeDisputeId_subOrderId_key" RENAME TO "Dispute_providerCaseId_subOrderId_key";
