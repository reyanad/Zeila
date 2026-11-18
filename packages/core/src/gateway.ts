/**
 * The payment provider as the money flows see it. Chapa implements it in
 * production (`createChapaGateway`); tests pass a fake. Amounts are always
 * integer minor units (santim for ETB) on this side of the boundary.
 */

export type GatewayChargeStatus = "success" | "failed" | "pending" | "not_found";

export interface GatewayTransaction {
  status: GatewayChargeStatus;
  amount: number;
  currency: string;
  /** The provider's own reference for the charge. */
  reference: string | null;
  /** How the buyer paid, e.g. "telebirr", "cbebirr", "card". */
  method: string | null;
  paidAt: Date | null;
}

export interface CheckoutInit {
  txRef: string;
  amount: number;
  currency: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  /** Ethiopian mobile number in 09xxxxxxxx or 07xxxxxxxx form, when known. */
  phone: string | null;
  callbackUrl: string;
  returnUrl: string;
  title: string;
  description: string;
}

export type GatewayRefundState = "PROCESSING" | "REFUNDED" | "REVERSED";

export interface RefundInit {
  txRef: string;
  amount: number;
  currency: string;
  reference: string;
  reason: string;
}

export interface TransferInit {
  reference: string;
  amount: number;
  currency: string;
  bankId: number;
  accountName: string;
  accountNumber: string;
}

export type TransferResult =
  | { kind: "queued"; transferId: string | null }
  /** Definitively refused; `retryable` when the account details are fine (e.g. the platform balance is low). */
  | { kind: "rejected"; message: string; retryable: boolean };

export type GatewayTransferStatus = "success" | "failed" | "pending" | "not_found";

export interface PayoutBank {
  id: number;
  name: string;
  /** Required account number length, or null when the bank does not say. */
  accountLength: number | null;
  currency: string;
  isMobileMoney: boolean;
}

export interface PaymentGateway {
  readonly name: "chapa";
  initializeCheckout(input: CheckoutInit): Promise<{ checkoutUrl: string }>;
  verifyTransaction(txRef: string): Promise<GatewayTransaction>;
  refund(input: RefundInit): Promise<{ refundId: string | null; state: GatewayRefundState }>;
  verifyRefund(refundId: string): Promise<{ state: GatewayRefundState; amount: number | null } | null>;
  transfer(input: TransferInit): Promise<TransferResult>;
  verifyTransfer(reference: string): Promise<{ status: GatewayTransferStatus; message: string | null }>;
  listBanks(): Promise<PayoutBank[]>;
}

/** A provider call failed in a way that leaves the outcome unknown (network, 5xx, unreadable answer). */
export class GatewayError extends Error {
  constructor(
    message: string,
    readonly httpStatus: number | null = null,
  ) {
    super(message);
    this.name = "GatewayError";
  }
}

/** Currencies Chapa can charge and pay out in. */
export const GATEWAY_CURRENCIES: readonly string[] = ["ETB", "USD"];
