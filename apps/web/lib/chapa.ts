import "server-only";
import { createChapaGateway, GatewayError, type PaymentGateway, type PayoutBank } from "@marketplace/core";
import { chapaApiUrl, chapaSecretKey } from "@/lib/env";

let gateway: PaymentGateway | null | undefined;

/** Chapa client, or null when CHAPA_SECRET_KEY is not configured. */
export function getChapa(): PaymentGateway | null {
  if (gateway !== undefined) return gateway;
  const key = chapaSecretKey();
  gateway = key ? createChapaGateway({ secretKey: key, baseUrl: chapaApiUrl() }) : null;
  return gateway;
}

/**
 * Message safe to show a signed-in user for a failed Chapa call. Chapa's own
 * explanations (for example an unsupported phone number) are passed on; a
 * connection problem stays generic.
 */
export function chapaErrorMessage(error: unknown): string {
  if (error instanceof GatewayError && error.httpStatus !== null && error.httpStatus < 500) return error.message;
  return "Chapa could not be reached. Try again in a few minutes.";
}

const BANKS_TTL_MS = 6 * 60 * 60_000;
let banks: { at: number; list: PayoutBank[] } | null = null;

/** Banks and wallets Chapa can pay out to in ETB, cached for a few hours. */
export async function payoutBanks(): Promise<PayoutBank[]> {
  if (banks && Date.now() - banks.at < BANKS_TTL_MS) return banks.list;
  const chapa = getChapa();
  if (!chapa) return [];
  const list = (await chapa.listBanks()).filter((bank) => bank.currency === "ETB");
  banks = { at: Date.now(), list };
  return list;
}
