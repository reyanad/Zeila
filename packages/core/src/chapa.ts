import { createHmac, timingSafeEqual } from "node:crypto";
import {
  GatewayError,
  type CheckoutInit,
  type GatewayChargeStatus,
  type GatewayRefundState,
  type GatewayTransaction,
  type GatewayTransferStatus,
  type PaymentGateway,
  type PayoutBank,
  type RefundInit,
  type TransferInit,
  type TransferResult,
} from "./gateway";

/**
 * Chapa (https://developer.chapa.co) over its REST API, without an SDK.
 *
 * - Buyers pay on Chapa's hosted checkout (telebirr, CBE Birr, M-Pesa, cards,
 *   bank transfer). We create the transaction with our own `tx_ref` and always
 *   confirm it with the verify endpoint before trusting a webhook or redirect.
 * - Sellers are paid with Chapa transfers to a bank account or mobile wallet.
 *
 * Chapa takes amounts as decimal strings in major units ("400.00"); this
 * module converts to and from integer minor units.
 */

export const CHAPA_API_URL = "https://api.chapa.co/v1";

/** 12345 -> "123.45". Chapa's currencies (ETB, USD) both have two decimals. */
export function toMajorString(minor: number): string {
  if (!Number.isInteger(minor) || minor < 0) throw new RangeError(`Invalid amount ${minor}`);
  return `${Math.floor(minor / 100)}.${String(minor % 100).padStart(2, "0")}`;
}

/** "123.45" | 123.45 | "100" -> 12345 | 12345 | 10000. Throws on anything else. */
export function parseMajorAmount(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) return Math.round(value * 100);
  if (typeof value === "string") {
    const match = /^\s*(\d+)(?:\.(\d{1,2})\d*)?\s*$/.exec(value);
    if (match) return Number(match[1]) * 100 + Number((match[2] ?? "0").padEnd(2, "0"));
  }
  throw new GatewayError(`Unexpected amount from Chapa: ${String(value)}`);
}

function hmacHex(key: string, payload: string): string {
  return createHmac("sha256", key).update(payload, "utf8").digest("hex");
}

function sameHex(expected: string, supplied: string | null | undefined): boolean {
  if (!supplied) return false;
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(supplied.trim().toLowerCase(), "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Chapa signs webhooks two ways: `x-chapa-signature` is an HMAC-SHA256 of the
 * payload with the webhook secret, `chapa-signature` an HMAC-SHA256 of the
 * secret itself. Either one valid is enough (Chapa's own guidance). The body
 * is checked as received and as Chapa's examples re-serialise it.
 */
export function verifyChapaSignature(input: { rawBody: string; chapaSignature: string | null; xChapaSignature: string | null; secret: string }): boolean {
  const { rawBody, secret } = input;
  if (!secret) return false;
  if (sameHex(hmacHex(secret, rawBody), input.xChapaSignature)) return true;
  try {
    const reserialised = JSON.stringify(JSON.parse(rawBody));
    if (reserialised !== rawBody && sameHex(hmacHex(secret, reserialised), input.xChapaSignature)) return true;
  } catch {
    // Not JSON: only the raw-body signature can match.
  }
  return sameHex(hmacHex(secret, secret), input.chapaSignature);
}

interface ChapaEnvelope {
  message?: unknown;
  status?: unknown;
  data?: unknown;
}

interface ChapaResponse {
  httpStatus: number;
  body: ChapaEnvelope;
}

function messageOf(body: ChapaEnvelope): string {
  const { message } = body;
  if (typeof message === "string") return message;
  if (message && typeof message === "object") {
    // Validation errors arrive as { field: ["problem"] }.
    return Object.entries(message as Record<string, unknown>)
      .map(([field, problems]) => `${field}: ${Array.isArray(problems) ? problems.join(", ") : String(problems)}`)
      .join("; ");
  }
  return "Chapa did not explain the problem";
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : typeof value === "number" ? String(value) : null;
}

function date(value: unknown): Date | null {
  if (typeof value !== "string") return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function chargeStatus(value: unknown): GatewayChargeStatus {
  const status = typeof value === "string" ? value.toLowerCase() : "";
  if (status === "success" || status === "successful") return "success";
  if (status === "failed" || status === "failure" || status === "cancelled" || status === "canceled" || status === "reversed") return "failed";
  return "pending";
}

function refundState(value: unknown): GatewayRefundState {
  const status = typeof value === "string" ? value.toLowerCase() : "";
  if (status === "refunded" || status === "success") return "REFUNDED";
  if (status === "reversed" || status === "failed") return "REVERSED";
  return "PROCESSING";
}

function transferStatus(value: unknown): GatewayTransferStatus {
  const status = typeof value === "string" ? value.toLowerCase() : "";
  if (status === "success" || status === "successful" || status === "completed") return "success";
  if (status === "failed" || status === "reversed" || status === "cancelled" || status === "canceled" || status === "rejected" || status === "reverted") return "failed";
  return "pending";
}

const NOT_FOUND = /not\s*(be\s*)?found|not\s*paid|invalid\s*(tx|transaction|reference)|no\s*(such\s*)?(transaction|transfer)/i;

/** Chapa caps the checkout title at 16 characters and allows only simple characters in the description. */
function checkoutText(value: string, max: number): string {
  return value.replace(/[^A-Za-z0-9 ._-]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
}

export interface ChapaOptions {
  secretKey: string;
  baseUrl?: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
}

export function createChapaGateway(options: ChapaOptions): PaymentGateway {
  const baseUrl = (options.baseUrl ?? CHAPA_API_URL).replace(/\/+$/, "");
  const doFetch = options.fetch ?? fetch;
  const timeoutMs = options.timeoutMs ?? 20_000;

  async function call(method: "GET" | "POST", path: string, payload?: Record<string, unknown>): Promise<ChapaResponse> {
    let response: Response;
    try {
      response = await doFetch(`${baseUrl}${path}`, {
        method,
        headers: { Authorization: `Bearer ${options.secretKey}`, "Content-Type": "application/json", Accept: "application/json" },
        body: payload ? JSON.stringify(payload) : undefined,
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      throw new GatewayError(`Chapa could not be reached: ${error instanceof Error ? error.message : String(error)}`);
    }
    let body: ChapaEnvelope = {};
    try {
      body = record(await response.json()) as ChapaEnvelope;
    } catch {
      if (response.status >= 500) throw new GatewayError(`Chapa answered ${response.status}`, response.status);
    }
    if (response.status >= 500) throw new GatewayError(`Chapa answered ${response.status}: ${messageOf(body)}`, response.status);
    return { httpStatus: response.status, body };
  }

  const ok = (res: ChapaResponse) => res.httpStatus < 300 && String(res.body.status ?? "").toLowerCase() === "success";

  return {
    name: "chapa",

    async initializeCheckout(input: CheckoutInit) {
      const res = await call("POST", "/transaction/initialize", {
        amount: toMajorString(input.amount),
        currency: input.currency,
        email: input.email,
        ...(input.firstName ? { first_name: input.firstName } : {}),
        ...(input.lastName ? { last_name: input.lastName } : {}),
        ...(input.phone ? { phone_number: input.phone } : {}),
        tx_ref: input.txRef,
        callback_url: input.callbackUrl,
        return_url: input.returnUrl,
        customization: { title: checkoutText(input.title, 16), description: checkoutText(input.description, 50) },
      });
      const checkoutUrl = text(record(res.body.data).checkout_url);
      if (!ok(res) || !checkoutUrl) throw new GatewayError(`Chapa refused the payment: ${messageOf(res.body)}`, res.httpStatus);
      return { checkoutUrl };
    },

    async verifyTransaction(txRef: string): Promise<GatewayTransaction> {
      const res = await call("GET", `/transaction/verify/${encodeURIComponent(txRef)}`);
      const message = messageOf(res.body);
      if (res.httpStatus === 404 || (!ok(res) && NOT_FOUND.test(message))) {
        return { status: "not_found", amount: 0, currency: "", reference: null, method: null, paidAt: null };
      }
      if (!ok(res)) throw new GatewayError(`Chapa could not verify ${txRef}: ${message}`, res.httpStatus);
      const data = record(res.body.data);
      if (Object.keys(data).length === 0) throw new GatewayError(`Chapa sent no details for ${txRef}`, res.httpStatus);
      return {
        status: chargeStatus(data.status),
        amount: parseMajorAmount(data.amount),
        currency: String(data.currency ?? "").toUpperCase(),
        reference: text(data.reference),
        method: text(data.method) ?? text(data.payment_method),
        paidAt: date(data.updated_at) ?? date(data.created_at),
      };
    },

    async refund(input: RefundInit) {
      const res = await call("POST", `/refund/${encodeURIComponent(input.txRef)}`, {
        amount: toMajorString(input.amount),
        reason: input.reason.slice(0, 200),
        reference: input.reference,
        meta: { reference: input.reference },
      });
      if (!ok(res)) throw new GatewayError(`Chapa refused the refund: ${messageOf(res.body)}`, res.httpStatus);
      const data = res.body.data;
      const fields = record(data);
      const refundId = typeof data === "string" ? data : (text(fields.ref_id) ?? text(fields.refund_id) ?? text(fields.reference));
      return { refundId, state: fields.status ? refundState(fields.status) : "PROCESSING" };
    },

    async verifyRefund(refundId: string) {
      const res = await call("GET", `/refund/${encodeURIComponent(refundId)}/verify`);
      if (res.httpStatus === 404) return null;
      if (!ok(res)) throw new GatewayError(`Chapa could not verify refund ${refundId}: ${messageOf(res.body)}`, res.httpStatus);
      const data = record(res.body.data);
      return { state: refundState(data.status), amount: data.amount === undefined ? null : parseMajorAmount(data.amount) };
    },

    async transfer(input: TransferInit): Promise<TransferResult> {
      const res = await call("POST", "/transfers", {
        account_name: input.accountName,
        account_number: input.accountNumber,
        amount: toMajorString(input.amount),
        currency: input.currency,
        reference: input.reference,
        bank_code: input.bankId,
      });
      if (ok(res)) return { kind: "queued", transferId: typeof res.body.data === "string" ? res.body.data : text(record(res.body.data).id) };
      const message = messageOf(res.body);
      if (res.httpStatus >= 400 && res.httpStatus < 500) {
        return { kind: "rejected", message, retryable: /insufficient|balance|limit|try again/i.test(message) };
      }
      throw new GatewayError(`Chapa did not confirm transfer ${input.reference}: ${message}`, res.httpStatus);
    },

    async verifyTransfer(reference: string) {
      const res = await call("GET", `/transfers/verify/${encodeURIComponent(reference)}`);
      const data = record(res.body.data);
      if (res.httpStatus === 404 || (!ok(res) && NOT_FOUND.test(messageOf(res.body)))) return { status: "not_found" as const, message: messageOf(res.body) };
      if (!ok(res)) throw new GatewayError(`Chapa could not verify transfer ${reference}: ${messageOf(res.body)}`, res.httpStatus);
      return { status: transferStatus(data.status), message: text(data.narration) ?? null };
    },

    async listBanks(): Promise<PayoutBank[]> {
      const res = await call("GET", "/banks");
      if (res.httpStatus >= 300 || !Array.isArray(res.body.data)) throw new GatewayError(`Chapa could not list banks: ${messageOf(res.body)}`, res.httpStatus);
      return res.body.data
        .map((entry) => record(entry))
        .filter((bank) => typeof bank.id === "number" && typeof bank.name === "string" && bank.is_active !== false && bank.is_active !== 0)
        .map((bank) => ({
          id: bank.id as number,
          name: (bank.name as string).trim(),
          accountLength: typeof bank.acct_length === "number" && bank.acct_length > 0 ? bank.acct_length : null,
          currency: String(bank.currency ?? "ETB").toUpperCase(),
          isMobileMoney: bank.is_mobilemoney === true || bank.is_mobilemoney === 1,
        }))
        .sort((a, b) => Number(a.isMobileMoney) - Number(b.isMobileMoney) || a.name.localeCompare(b.name));
    },
  };
}
