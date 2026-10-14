import { describe, expect, it } from "vitest";
import { POPULAR_TOKENS, SOL_MINT, USDC_MINT } from "@/lib/constants";
import {
  dcaFormView,
  estimateReceive,
  expiryMs,
  intervalSeconds,
  limitFormView,
  liveBasePrice,
  parseCount,
  parsePrice,
  payToken,
  payUsd,
  receiveToken,
  triggerOffsets,
  type DcaFormInput,
  type LimitFormInput,
} from "./triggerForms";

const SOL = POPULAR_TOKENS.find((t) => t.mint === SOL_MINT)!;
const USDC = POPULAR_TOKENS.find((t) => t.mint === USDC_MINT)!;

function limit(over: Partial<LimitFormInput> = {}): LimitFormInput {
  return {
    base: SOL,
    side: "buy",
    payAmount: "100",
    triggerPrice: "140",
    expiry: "7d",
    marketPriceUsd: 150,
    balanceRaw: "1000000000", // 1000 USDC
    ...over,
  };
}

function dca(over: Partial<DcaFormInput> = {}): DcaFormInput {
  return {
    base: SOL,
    side: "buy",
    totalAmount: "100",
    orderCount: "4",
    interval: "day",
    customHours: "",
    marketPriceUsd: 150,
    balanceRaw: "1000000000",
    activeDcaCount: 0,
    ...over,
  };
}

describe("parsing and pair helpers", () => {
  it("parses prices and counts strictly", () => {
    expect(parsePrice("140.5")).toBe(140.5);
    expect(parsePrice(".5")).toBe(0.5);
    expect(parsePrice("0")).toBeNull();
    expect(parsePrice("1e3")).toBeNull();
    expect(parsePrice("")).toBeNull();
    expect(parseCount("12")).toBe(12);
    expect(parseCount("0")).toBeNull();
    expect(parseCount("1.5")).toBeNull();
  });

  it("maps the side to pay/receive tokens and offsets", () => {
    expect(payToken(SOL, "buy")).toBe(USDC);
    expect(payToken(SOL, "sell")).toBe(SOL);
    expect(receiveToken(SOL, "buy")).toBe(SOL);
    expect(triggerOffsets("buy")).toEqual([-1, -5, -10]);
    expect(triggerOffsets("sell")).toEqual([1, 5, 10]);
    expect(expiryMs("1d")).toBe(86_400_000);
    expect(expiryMs("30d")).toBe(30 * 86_400_000);
  });

  it("estimates output at the trigger price", () => {
    expect(estimateReceive("buy", "100", 140)).toBe("0.714285");
    expect(estimateReceive("sell", "2", 200)).toBe("400");
    expect(estimateReceive("buy", "100", null)).toBeNull();
    expect(estimateReceive("buy", "", 140)).toBeNull();
  });

  it("values what is paid", () => {
    expect(payUsd("buy", "25", null)).toBe(25);
    expect(payUsd("sell", "2", 150)).toBe(300);
    // Buys pay USDC, valued at its live price when known.
    expect(payUsd("buy", "10", null, 0.999)).toBeCloseTo(9.99);
    expect(payUsd("buy", "10", null, null)).toBe(10);
    expect(payUsd("buy", "10", null, 0)).toBe(10);
    expect(payUsd("sell", "2", null)).toBeNull();
  });

  it("prefers the live price and flags delayed ones", () => {
    expect(liveBasePrice({ usdPrice: 1 }, { data: { priceUsd: 150 }, isError: false })).toEqual({ priceUsd: 150, stale: false });
    expect(liveBasePrice({}, { data: { priceUsd: 150, stale: true }, isError: false }).stale).toBe(true);
    expect(liveBasePrice({}, { data: { priceUsd: 150 }, isError: true }).stale).toBe(true);
    expect(liveBasePrice({ usdPrice: 149 }, { data: undefined, isError: false })).toEqual({ priceUsd: 149, stale: true });
    expect(liveBasePrice({}, { data: { priceUsd: null }, isError: false })).toEqual({ priceUsd: null, stale: false });
  });
});

describe("limitFormView", () => {
  it("accepts a valid buy below market", () => {
    const v = limitFormView(limit());
    expect(v.blocker).toBeNull();
    expect(v.payRaw).toBe("100000000");
    expect(v.distancePct).toBeCloseTo(-6.667, 2);
    expect(v.estReceive).toBe("0.714285");
    expect(v.depositUsd).toBe(100);
    expect(v.belowMinimum).toBe(false);
    expect(v.warnings).toEqual([]);
  });

  it("explains each missing input in order", () => {
    expect(limitFormView(limit({ payAmount: "" })).blocker).toBe("Enter an amount");
    expect(limitFormView(limit({ balanceRaw: "1000000" })).blocker).toBe("Insufficient USDC balance");
    expect(limitFormView(limit({ triggerPrice: "" })).blocker).toBe("Enter a trigger price");
    expect(limitFormView(limit({ base: USDC })).blocker).toBe("Pick a non-stable token");
  });

  it("does not claim insufficient funds while the balance is unknown", () => {
    expect(limitFormView(limit({ balanceRaw: undefined })).blocker).toBeNull();
  });

  it("refuses the wrong side of the market", () => {
    expect(limitFormView(limit({ triggerPrice: "155" })).blocker).toMatch(/buy limit must be below/);
    expect(
      limitFormView(limit({ side: "sell", payAmount: "1", triggerPrice: "140", balanceRaw: "5000000000" })).blocker
    ).toMatch(/sell limit must be above/);
  });

  it("enforces the $10 minimum", () => {
    const v = limitFormView(limit({ payAmount: "5" }));
    expect(v.belowMinimum).toBe(true);
    expect(v.blocker).toMatch(/Minimum order is \$10/);
  });

  it("needs a price to check the side of market", () => {
    expect(limitFormView(limit({ marketPriceUsd: null })).blocker).toMatch(/Could not load the current SOL price/);
  });

  it("values sells at the market price and estimates USDC out", () => {
    const v = limitFormView(
      limit({ side: "sell", payAmount: "2", triggerPrice: "200", balanceRaw: "5000000000" })
    );
    expect(v.blocker).toBeNull();
    expect(v.depositUsd).toBe(300);
    expect(v.estReceive).toBe("400");
  });

  it("warns near and far from market, and on delayed prices", () => {
    expect(limitFormView(limit({ triggerPrice: "149.5" })).warnings[0]).toMatch(/very close/);
    expect(limitFormView(limit({ triggerPrice: "50" })).warnings[0]).toMatch(/67% from the market/);
    expect(limitFormView(limit({ marketStale: true })).warnings.join(" ")).toMatch(/delayed/);
  });
});

describe("intervalSeconds", () => {
  it("uses presets and bounds custom hours", () => {
    expect(intervalSeconds("minute", "")).toBe(60);
    expect(intervalSeconds("week", "")).toBe(604_800);
    expect(intervalSeconds("custom", "4")).toBe(14_400);
    expect(intervalSeconds("custom", "0.5")).toBe(1_800);
    expect(intervalSeconds("custom", "8760")).toBe(31_536_000);
    expect(intervalSeconds("custom", "8761")).toBeNull();
    expect(intervalSeconds("custom", "0.001")).toBeNull();
    expect(intervalSeconds("custom", "")).toBeNull();
  });
});

describe("dcaFormView", () => {
  it("splits a valid buy into rounds", () => {
    const v = dcaFormView(dca());
    expect(v.blocker).toBeNull();
    expect(v.perRound).toBe("25");
    expect(v.perRoundUsd).toBe(25);
    expect(v.totalUsd).toBe(100);
    expect(v.durationSeconds).toBe(3 * 86_400);
    expect(v.atCap).toBe(false);
  });

  it("enforces $10 per round", () => {
    const v = dcaFormView(dca({ totalAmount: "30" }));
    expect(v.belowMinimum).toBe(true);
    expect(v.blocker).toMatch(/Each order must be worth at least \$10/);
  });

  it("validates count, interval, balance and the active cap", () => {
    expect(dcaFormView(dca({ orderCount: "1" })).blocker).toMatch(/between 2 and/);
    expect(dcaFormView(dca({ orderCount: "" })).blocker).toMatch(/between 2 and/);
    expect(dcaFormView(dca({ interval: "custom", customHours: "0.001" })).blocker).toMatch(/Custom interval/);
    expect(dcaFormView(dca({ balanceRaw: "1000000" })).blocker).toBe("Insufficient USDC balance");
    const capped = dcaFormView(dca({ activeDcaCount: 10 }));
    expect(capped.atCap).toBe(true);
    expect(capped.blocker).toMatch(/10 active DCA orders/);
    expect(dcaFormView(dca({ activeDcaCount: null })).blocker).toBeNull();
  });

  it("leaves the sell minimum to Jupiter when there is no price, and says so", () => {
    const v = dcaFormView(
      dca({ side: "sell", totalAmount: "0.1", marketPriceUsd: null, balanceRaw: "5000000000" })
    );
    expect(v.blocker).toBeNull();
    expect(v.perRoundUsd).toBeNull();
    expect(v.warnings[0]).toMatch(/checked by Jupiter/);
  });

  it("computes custom schedules", () => {
    const v = dcaFormView(dca({ interval: "custom", customHours: "6", orderCount: "5" }));
    expect(v.intervalSeconds).toBe(21_600);
    expect(v.durationSeconds).toBe(4 * 21_600);
    expect(v.perRound).toBe("20");
  });
});

describe("near the $10 minimum", () => {
  it("limit: blocks 10 USDC below the peg and nudges just above the minimum", () => {
    const below = limitFormView(limit({ payAmount: "10", usdcPriceUsd: 0.9997 }));
    expect(below.belowMinimum).toBe(true);
    expect(below.blocker).toMatch(/Minimum/);
    const near = limitFormView(limit({ payAmount: "10.1", usdcPriceUsd: 0.9997 }));
    expect(near.belowMinimum).toBe(false);
    expect(near.nearMinimum).toBe(true);
    expect(limitFormView(limit({ payAmount: "25" })).nearMinimum).toBe(false);
  });

  it("dca: nudges when each round only just clears the minimum", () => {
    expect(dcaFormView(dca({ totalAmount: "20.2", orderCount: "2" })).nearMinimum).toBe(true);
    expect(dcaFormView(dca({ totalAmount: "100", orderCount: "2" })).nearMinimum).toBe(false);
  });
});

describe("delayed market price", () => {
  it("does not block on a side-of-market verdict from a delayed price (the hook re-checks live)", () => {
    // Buy trigger above the delayed price: blocked when live, not when delayed.
    expect(limitFormView(limit({ triggerPrice: "155" })).blocker).toMatch(/must be below/);
    const delayed = limitFormView(limit({ triggerPrice: "155", marketStale: true }));
    expect(delayed.blocker).toBeNull();
    expect(delayed.warnings.join(" ")).toMatch(/delayed/);
    // Other checks still apply.
    expect(limitFormView(limit({ payAmount: "5", marketStale: true })).blocker).toMatch(/Minimum/);
  });
});
