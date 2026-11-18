import { describe, expect, it } from "vitest";
import { githubEmailIsVerified } from "./github-email";

function fakeFetch(status: number, body: unknown): typeof fetch {
  return (async () => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } })) as typeof fetch;
}

describe("githubEmailIsVerified", () => {
  it("accepts an address GitHub has verified", async () => {
    const result = await githubEmailIsVerified("token", "hana@example.com", fakeFetch(200, [{ email: "Hana@Example.com", verified: true, primary: true }]));
    expect(result).toBe(true);
  });

  it("refuses an address GitHub has not verified", async () => {
    const result = await githubEmailIsVerified("token", "hana@example.com", fakeFetch(200, [{ email: "hana@example.com", verified: false, primary: true }]));
    expect(result).toBe(false);
  });

  it("refuses when the address is not on the GitHub account", async () => {
    const result = await githubEmailIsVerified("token", "hana@example.com", fakeFetch(200, [{ email: "someone@example.com", verified: true }]));
    expect(result).toBe(false);
  });

  it("refuses without a token or when GitHub errors", async () => {
    expect(await githubEmailIsVerified(undefined, "hana@example.com", fakeFetch(200, []))).toBe(false);
    expect(await githubEmailIsVerified("token", "hana@example.com", fakeFetch(401, { message: "Bad credentials" }))).toBe(false);
    expect(await githubEmailIsVerified("token", "hana@example.com", fakeFetch(200, { not: "a list" }))).toBe(false);
  });
});
