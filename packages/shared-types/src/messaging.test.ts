import { describe, expect, it } from "vitest";
import { HIDDEN_CONTACT, screenMessage } from "./messaging";

describe("screenMessage", () => {
  it("hides Ethiopian and international phone numbers", () => {
    const result = screenMessage("Call me on +251 911 234 567 or 0911234567 or +1 (415) 555-0100");
    expect(result.text).not.toMatch(/911|555/);
    expect(result.reasons).toContain("phone");
  });
  it("hides e-mails, including spelled-out ones", () => {
    const result = screenMessage("abebe.k@gmail.com or abebe (at) gmail (dot) com");
    expect(result.text).not.toMatch(/gmail/);
    expect(result.reasons).toContain("email");
  });
  it("hides messaging links and handles; flags payment talk", () => {
    const result = screenMessage("Join t.me/abebeshop or @abebe_shop and pay with Telebirr to skip the fee");
    expect(result.text).toContain(HIDDEN_CONTACT);
    expect(result.text).not.toMatch(/abebe/);
    expect(result.reasons).toEqual(expect.arrayContaining(["link", "payment"]));
  });
  it("flags Amharic payment and app terms", () => {
    expect(screenMessage("በቴሌብር ይክፈሉ").reasons).toContain("payment");
    expect(screenMessage("ቴሌግራም ላይ ፃፍልኝ").reasons).toContain("app");
  });
  it("leaves order numbers, dates, times and prices alone", () => {
    const text = "Order MP-20261117-AB12CD ships 2026-11-20 at 10:30, 1,500 ETB for 3 items.";
    expect(screenMessage(text)).toEqual({ text, flagged: false, reasons: [] });
  });
  it("is stable across calls (no leftover regex state)", () => {
    expect(screenMessage("whatsapp").flagged).toBe(true);
    expect(screenMessage("whatsapp").flagged).toBe(true);
  });
});
