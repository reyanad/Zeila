import { describe, expect, it } from "vitest";
import { applyBps, convertMinor, minorToInput, parseMoneyInput, type FxRates } from "./money";

describe("money input", () => {
  it("parses amounts into minor units", () => {
    expect(parseMoneyInput("12.5")).toBe(1_250);
    expect(parseMoneyInput("1,500")).toBe(150_000);
    expect(parseMoneyInput(" 0.07 ")).toBe(7);
    expect(parseMoneyInput("12.345")).toBeNull();
    expect(parseMoneyInput("abc")).toBeNull();
    expect(parseMoneyInput("-5")).toBeNull();
  });
  it("round-trips for editing", () => {
    for (const minor of [0, 7, 1_250, 150_000]) expect(parseMoneyInput(minorToInput(minor))).toBe(minor);
  });
});

describe("applyBps", () => {
  it("applies basis points with rounding", () => {
    expect(applyBps(10_000, 500)).toBe(500);
    expect(applyBps(999, 500)).toBe(50);
    expect(applyBps(0, 500)).toBe(0);
  });
});

describe("convertMinor", () => {
  const fx: FxRates = { base: "USD", rates: { USD: 1, ETB: 125, EUR: 0.9 }, fetchedAt: "2026-11-01T00:00:00Z" };
  it("converts through the base currency", () => {
    expect(convertMinor(100, "USD", "ETB", fx)).toBe(12_500);
    expect(convertMinor(12_500, "ETB", "USD", fx)).toBe(100);
    expect(convertMinor(500, "USD", "USD", fx)).toBe(500);
  });
  it("returns null without rates", () => {
    expect(convertMinor(100, "USD", "ETB", null)).toBeNull();
  });
});
