import { describe, expect, it } from "vitest";
import { contentSecurityPolicy } from "./csp";

describe("contentSecurityPolicy", () => {
  it("locks production pages down to nonced scripts and our own origins", () => {
    const policy = contentSecurityPolicy("abc123", { production: true, assetBaseUrl: "https://cdn.zeila.example/assets", realtimeUrl: "https://rt.zeila.example" });
    expect(policy).toContain("script-src 'self' 'nonce-abc123' 'strict-dynamic';");
    expect(policy).toContain("form-action 'self' https://checkout.chapa.co");
    expect(policy).toContain("frame-src 'none'");
    expect(policy).not.toContain("stripe");
    expect(policy).not.toContain("unsafe-eval");
    expect(policy).toContain("https://cdn.zeila.example");
    expect(policy).toContain("wss://rt.zeila.example");
    expect(policy).toContain("frame-ancestors 'none'");
    expect(policy).toContain("object-src 'none'");
    expect(policy.endsWith("upgrade-insecure-requests")).toBe(true);
  });
  it("relaxes only what development tooling needs", () => {
    const policy = contentSecurityPolicy("n", { production: false });
    expect(policy).toContain("'unsafe-eval'");
    expect(policy).toContain("ws:");
    expect(policy).not.toContain("upgrade-insecure-requests");
  });
  it("ignores malformed URLs", () => {
    expect(contentSecurityPolicy("n", { production: true, assetBaseUrl: "not a url" })).not.toContain("not a url");
  });
});
