import { describe, expect, it } from "vitest";
import { isRealtimeEvent, signRealtimeTicket, verifyRealtimeTicket } from "./index";

describe("realtime tickets", () => {
  const now = 1_800_000_000_000;
  const ticket = signRealtimeTicket("secret-one", "user_1", 60, now);
  it("verifies for the right secret within the lifetime", () => {
    expect(verifyRealtimeTicket("secret-one", ticket, now)).toBe("user_1");
    expect(verifyRealtimeTicket("secret-one", ticket, now + 59_000)).toBe("user_1");
  });
  it("refuses another secret, expiry and forgery", () => {
    expect(verifyRealtimeTicket("secret-two", ticket, now)).toBeNull();
    expect(verifyRealtimeTicket("secret-one", ticket, now + 61_000)).toBeNull();
    const signature = ticket.split(".")[1];
    const forged = `${Buffer.from(JSON.stringify({ sub: "admin", exp: 9e9 })).toString("base64url")}.${signature}`;
    expect(verifyRealtimeTicket("secret-one", forged, now)).toBeNull();
    expect(verifyRealtimeTicket("secret-one", "garbage", now)).toBeNull();
  });
});

describe("isRealtimeEvent", () => {
  it("accepts known event shapes only", () => {
    expect(isRealtimeEvent({ type: "typing", conversationId: "c", userId: "u", name: null })).toBe(true);
    expect(isRealtimeEvent({ type: "drop-tables" })).toBe(false);
    expect(isRealtimeEvent(null)).toBe(false);
  });
});
