import { describe, expect, it } from "vitest";
import { checkRequote } from "./requote";

const shown = { outAmount: "1000000", otherAmountThreshold: "977000" };

describe("checkRequote", () => {
  it("accepts an equal or better order", () => {
    expect(checkRequote(shown, shown)).toBe("ok");
    expect(checkRequote({ outAmount: "1100000", otherAmountThreshold: "990000" }, shown)).toBe("ok");
  });

  it("accepts up to 50 bps worse on both amounts", () => {
    expect(checkRequote({ outAmount: "995000", otherAmountThreshold: "972115" }, shown)).toBe("ok");
  });

  it("stops when the expected output is much worse", () => {
    expect(checkRequote({ outAmount: "994999", otherAmountThreshold: "977000" }, shown)).toBe(
      "price-moved"
    );
  });

  it("stops when only the minimum received dropped (e.g. Auto slippage rose)", () => {
    // Same outAmount, slippage 2.3% -> 10%.
    expect(checkRequote({ outAmount: "1000000", otherAmountThreshold: "900000" }, shown)).toBe(
      "min-received-lower"
    );
    // RFQ (threshold == out) replaced by an aggregator route with 1% slippage.
    const rfq = { outAmount: "1000000", otherAmountThreshold: "1000000" };
    expect(checkRequote({ outAmount: "999000", otherAmountThreshold: "989010" }, rfq)).toBe(
      "min-received-lower"
    );
  });

  it("does not loop: the fresh order passes against itself", () => {
    const fresh = { outAmount: "1000000", otherAmountThreshold: "900000" };
    expect(checkRequote(fresh, shown)).not.toBe("ok");
    expect(checkRequote(fresh, fresh)).toBe("ok");
  });
});
