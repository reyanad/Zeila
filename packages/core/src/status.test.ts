import { describe, expect, it } from "vitest";
import { nextSubOrderStatus } from "./status";

const P = (status: string) => ({ status, listingType: "PHYSICAL" });
const D = (status: string) => ({ status, listingType: "DIGITAL" });
const S = (status: string) => ({ status, listingType: "SERVICE" });

describe("nextSubOrderStatus", () => {
  it.each([
    ["paid physical waits", "PAID", [P("PENDING")], "PAID"],
    ["preparing stays", "PROCESSING", [P("PENDING")], "PROCESSING"],
    ["shipped", "PROCESSING", [P("FULFILLING")], "SHIPPED"],
    ["delivered", "SHIPPED", [P("DELIVERED")], "DELIVERED"],
    ["download + parcel in transit", "PAID", [D("DELIVERED"), P("FULFILLING")], "SHIPPED"],
    ["download + parcel delivered", "SHIPPED", [D("DELIVERED"), P("DELIVERED")], "DELIVERED"],
    ["service started", "PAID", [S("FULFILLING")], "IN_PROGRESS"],
    ["service delivered", "IN_PROGRESS", [S("DELIVERED")], "DELIVERED"],
    ["service approved", "DELIVERED", [S("COMPLETED")], "COMPLETED"],
    ["service revision outranks shipped", "SHIPPED", [P("FULFILLING"), S("FULFILLING")], "IN_PROGRESS"],
    ["refunded item ignored", "SHIPPED", [P("REFUNDED"), P("DELIVERED")], "DELIVERED"],
    ["everything refunded", "DELIVERED", [P("REFUNDED")], "REFUNDED"],
  ] as const)("%s", (_name, current, items, expected) => {
    expect(nextSubOrderStatus(current, items)).toBe(expected);
  });
});
