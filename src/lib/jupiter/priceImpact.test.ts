import { describe, expect, it } from "vitest";
import { formatPriceImpact, getImpactSeverity, getPriceImpactPercent } from "./priceImpact";

describe("getPriceImpactPercent", () => {
  it("prefers numeric priceImpact (already percent)", () => {
    expect(getPriceImpactPercent({ priceImpact: -99.43, priceImpactPct: "-0.5" })).toBeCloseTo(99.43);
    expect(getPriceImpactPercent({ priceImpact: -0.018 })).toBeCloseTo(0.018);
  });

  it("falls back to priceImpactPct (fraction string)", () => {
    expect(getPriceImpactPercent({ priceImpactPct: "-0.994" })).toBeCloseTo(99.4);
    expect(getPriceImpactPercent({ priceImpactPct: "-0.00022067845856437395" })).toBeCloseTo(0.022067, 5);
  });

  it("treats favorable impact as zero", () => {
    expect(getPriceImpactPercent({ priceImpact: 0.5 })).toBe(0);
    expect(getPriceImpactPercent({ priceImpactPct: "0.01" })).toBe(0);
    expect(getPriceImpactPercent({ priceImpact: 0 })).toBe(0);
  });

  it("handles missing and garbage values", () => {
    expect(getPriceImpactPercent(null)).toBe(0);
    expect(getPriceImpactPercent({})).toBe(0);
    expect(getPriceImpactPercent({ priceImpactPct: "abc" })).toBe(0);
    expect(getPriceImpactPercent({ priceImpact: NaN, priceImpactPct: "-0.2" })).toBeCloseTo(20);
  });
});

describe("getImpactSeverity", () => {
  it("buckets", () => {
    expect(getImpactSeverity(0)).toBe("low");
    expect(getImpactSeverity(0.99)).toBe("low");
    expect(getImpactSeverity(1)).toBe("medium");
    expect(getImpactSeverity(4.99)).toBe("medium");
    expect(getImpactSeverity(5)).toBe("high");
    expect(getImpactSeverity(14.99)).toBe("high");
    expect(getImpactSeverity(15)).toBe("extreme");
    expect(getImpactSeverity(99.4)).toBe("extreme");
  });
});

describe("formatPriceImpact", () => {
  it("formats", () => {
    expect(formatPriceImpact(0)).toBe("<0.01%");
    expect(formatPriceImpact(0.0099)).toBe("<0.01%");
    expect(formatPriceImpact(0.018)).toBe("0.02%");
    expect(formatPriceImpact(99.43)).toBe("99.43%");
  });
});
