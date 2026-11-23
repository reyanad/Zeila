import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createChapaGateway, parseMajorAmount, toMajorString, verifyChapaSignature } from "./chapa";
import { decryptAtRest, encryptAtRest } from "./field-crypto";
import { GatewayError } from "./gateway";
import { chapaPhone } from "./payments";

interface Call {
  url: string;
  method: string;
  body: Record<string, unknown> | null;
  auth: string | null;
}

/** A fetch that answers from a script and records what was sent. */
function scripted(answers: Array<{ status: number; body: unknown }>): { fetch: typeof fetch; calls: Call[] } {
  const calls: Call[] = [];
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    calls.push({ url: String(input), method: init?.method ?? "GET", body: init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null, auth: headers.get("authorization") });
    const answer = answers.shift() ?? { status: 500, body: {} };
    return new Response(JSON.stringify(answer.body), { status: answer.status, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;
  return { fetch: fetchImpl, calls };
}

describe("amounts", () => {
  it("converts minor units to Chapa's decimal strings and back", () => {
    expect(toMajorString(40_000)).toBe("400.00");
    expect(toMajorString(12_345)).toBe("123.45");
    expect(toMajorString(5)).toBe("0.05");
    expect(parseMajorAmount("400.00")).toBe(40_000);
    expect(parseMajorAmount("123.4")).toBe(12_340);
    expect(parseMajorAmount(100)).toBe(10_000);
    expect(parseMajorAmount(3.5)).toBe(350);
    expect(() => parseMajorAmount("12,00")).toThrow(GatewayError);
    expect(() => toMajorString(1.5)).toThrow(RangeError);
  });

  it("normalises Ethiopian mobile numbers for checkout", () => {
    expect(chapaPhone("+251 911 234 567")).toBe("0911234567");
    expect(chapaPhone("0711234567")).toBe("0711234567");
    expect(chapaPhone("251911234567")).toBe("0911234567");
    expect(chapaPhone("12345")).toBeNull();
    expect(chapaPhone(null)).toBeNull();
  });
});

describe("webhook signatures", () => {
  const secret = "whsec-test-secret";
  const body = JSON.stringify({ event: "charge.success", tx_ref: "MP-1-1", status: "success" });

  it("accepts an HMAC of the payload in x-chapa-signature", () => {
    const signature = createHmac("sha256", secret).update(body).digest("hex");
    expect(verifyChapaSignature({ rawBody: body, xChapaSignature: signature, chapaSignature: null, secret })).toBe(true);
  });

  it("accepts an HMAC of the secret in chapa-signature", () => {
    const signature = createHmac("sha256", secret).update(secret).digest("hex");
    expect(verifyChapaSignature({ rawBody: body, xChapaSignature: null, chapaSignature: signature, secret })).toBe(true);
  });

  it("rejects missing, wrong or tampered signatures", () => {
    const signature = createHmac("sha256", secret).update(body).digest("hex");
    expect(verifyChapaSignature({ rawBody: body, xChapaSignature: null, chapaSignature: null, secret })).toBe(false);
    expect(verifyChapaSignature({ rawBody: body.replace("success", "failed"), xChapaSignature: signature, chapaSignature: null, secret })).toBe(false);
    expect(verifyChapaSignature({ rawBody: body, xChapaSignature: signature, chapaSignature: null, secret: "other" })).toBe(false);
    expect(verifyChapaSignature({ rawBody: body, xChapaSignature: signature, chapaSignature: null, secret: "" })).toBe(false);
  });
});

describe("Chapa client", () => {
  it("starts a hosted checkout with major-unit amounts and our tx_ref", async () => {
    const { fetch, calls } = scripted([{ status: 200, body: { status: "success", message: "Hosted Link", data: { checkout_url: "https://checkout.chapa.co/checkout/payment/abc" } } }]);
    const chapa = createChapaGateway({ secretKey: "CHASECK_TEST-123", baseUrl: "https://chapa.test/v1", fetch });
    const result = await chapa.initializeCheckout({
      txRef: "MP-20261118-ABC123-1",
      amount: 204_000,
      currency: "ETB",
      email: "hana@example.com",
      firstName: "Hana",
      lastName: "Tesfaye",
      phone: "0911234567",
      callbackUrl: "https://negadras.test/cb",
      returnUrl: "https://negadras.test/return",
      title: "Negadras marketplace checkout",
      description: "Order MP-20261118-ABC123 (2 items)",
    });
    expect(result.checkoutUrl).toBe("https://checkout.chapa.co/checkout/payment/abc");
    expect(calls[0]?.url).toBe("https://chapa.test/v1/transaction/initialize");
    expect(calls[0]?.auth).toBe("Bearer CHASECK_TEST-123");
    expect(calls[0]?.body).toMatchObject({ amount: "2040.00", currency: "ETB", tx_ref: "MP-20261118-ABC123-1", phone_number: "0911234567" });
    const customization = calls[0]?.body?.customization as { title: string; description: string };
    expect(customization.title.length).toBeLessThanOrEqual(16);
    expect(customization.description).toMatch(/^[A-Za-z0-9 ._-]+$/);
  });

  it("reads verify answers: paid, unpaid and errors", async () => {
    const { fetch } = scripted([
      { status: 200, body: { status: "success", message: "Payment details", data: { status: "success", amount: 2040, currency: "ETB", reference: "APxyz", method: "telebirr", created_at: "2026-11-18T10:00:00.000000Z" } } },
      { status: 404, body: { status: null, message: "Payment not paid yet", data: null } },
      { status: 401, body: { status: "failed", message: "Invalid API Key or User doesn't exist", data: null } },
    ]);
    const chapa = createChapaGateway({ secretKey: "k", baseUrl: "https://chapa.test/v1", fetch });
    await expect(chapa.verifyTransaction("A-1")).resolves.toMatchObject({ status: "success", amount: 204_000, currency: "ETB", reference: "APxyz", method: "telebirr" });
    await expect(chapa.verifyTransaction("A-2")).resolves.toMatchObject({ status: "not_found" });
    await expect(chapa.verifyTransaction("A-3")).rejects.toThrow(GatewayError);
  });

  it("separates refused transfers from unknown outcomes", async () => {
    const { fetch, calls } = scripted([
      { status: 200, body: { status: "success", message: "Transfer Queued Successfully", data: "3241342142sfdd" } },
      { status: 400, body: { status: "failed", message: "Insufficient Balance", data: null } },
      { status: 400, body: { status: "failed", message: { account_number: ["The account number is invalid."] }, data: null } },
      { status: 502, body: {} },
    ]);
    const chapa = createChapaGateway({ secretKey: "k", baseUrl: "https://chapa.test/v1", fetch });
    const input = { reference: "po-1", amount: 150_075, currency: "ETB", bankId: 946, accountName: "Abebe Bekele", accountNumber: "1000123456789" };
    await expect(chapa.transfer(input)).resolves.toEqual({ kind: "queued", transferId: "3241342142sfdd" });
    expect(calls[0]?.body).toMatchObject({ amount: "1500.75", bank_code: 946, reference: "po-1", account_number: "1000123456789" });
    await expect(chapa.transfer(input)).resolves.toEqual({ kind: "rejected", message: "Insufficient Balance", retryable: true });
    await expect(chapa.transfer(input)).resolves.toMatchObject({ kind: "rejected", retryable: false });
    await expect(chapa.transfer(input)).rejects.toThrow(GatewayError);
  });

  it("lists active banks and wallets with account lengths", async () => {
    const { fetch } = scripted([
      {
        status: 200,
        body: {
          message: "Banks retrieved",
          data: [
            { id: 855, name: "telebirr", acct_length: 10, currency: "ETB", is_mobilemoney: 1, is_active: 1 },
            { id: 946, name: "Commercial Bank of Ethiopia (CBE)", acct_length: 13, currency: "ETB", is_mobilemoney: null, is_active: 1 },
            { id: 1, name: "Closed bank", acct_length: 10, currency: "ETB", is_active: 0 },
          ],
        },
      },
    ]);
    const banks = await createChapaGateway({ secretKey: "k", baseUrl: "https://chapa.test/v1", fetch }).listBanks();
    expect(banks).toEqual([
      { id: 946, name: "Commercial Bank of Ethiopia (CBE)", accountLength: 13, currency: "ETB", isMobileMoney: false },
      { id: 855, name: "telebirr", accountLength: 10, currency: "ETB", isMobileMoney: true },
    ]);
  });
});

describe("encryption at rest", () => {
  it("round-trips and detects tampering", () => {
    const sealed = encryptAtRest("1000123456789");
    expect(sealed).toMatch(/^v1\./);
    expect(sealed).not.toContain("1000123456789");
    expect(decryptAtRest(sealed)).toBe("1000123456789");
    const parts = sealed.split(".");
    const tampered = [parts[0], parts[1], parts[2], Buffer.from("x").toString("base64url")].join(".");
    expect(() => decryptAtRest(tampered)).toThrow();
  });
});
