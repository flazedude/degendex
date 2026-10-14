import { describe, expect, it } from "vitest";
import {
  changeClass,
  formatCompactUsd,
  formatCount,
  formatPct,
  formatPlainPrice,
  formatPrice,
  shortMint,
} from "./terminalFormat";
import { chartPriceFormat, liveCandle, prepareCandles } from "./chartData";
import type { Candle } from "@/lib/markets/types";

const c = (time: number, close: number, extra: Partial<Candle> = {}): Candle => ({
  time,
  open: close,
  high: close,
  low: close,
  close,
  volume: 1,
  ...extra,
});

describe("formatPlainPrice / formatPrice", () => {
  it("formats majors and mid prices", () => {
    expect(formatPrice(107.2155)).toBe("$107.22");
    expect(formatPrice(65_432.1)).toBe("$65,432.10");
    expect(formatPrice(1.23456)).toBe("$1.2346");
    expect(formatPrice(0.41234)).toBe("$0.4123");
  });

  it("keeps four significant digits for small prices", () => {
    expect(formatPlainPrice(0.0001234)).toBe("0.0001234");
    expect(formatPlainPrice(0.01)).toBe("0.01");
    expect(formatPlainPrice(0.099999)).toBe("0.1");
  });

  it("uses a subscript zero count for tiny prices", () => {
    expect(formatPlainPrice(0.00000322)).toBe("0.0₅322");
    expect(formatPlainPrice(0.000012346)).toBe("0.0₄1235");
    expect(formatPlainPrice(1.2e-12)).toBe("0.0₁₁12");
  });

  it("handles unknown, zero and rounding to one", () => {
    expect(formatPrice(null)).toBe("—");
    expect(formatPrice(Number.NaN)).toBe("—");
    expect(formatPrice(0)).toBe("$0");
    expect(formatPrice(0.99999)).toBe("$1.00");
  });
});

describe("other formatters", () => {
  it("compacts USD", () => {
    expect(formatCompactUsd(3.57e9)).toBe("$3.57B");
    expect(formatCompactUsd(61_234)).toBe("$61.23K");
    expect(formatCompactUsd(950)).toBe("$950.00");
    expect(formatCompactUsd(null)).toBe("—");
  });

  it("signs percentages", () => {
    expect(formatPct(1.234)).toBe("+1.23%");
    expect(formatPct(-0.4)).toBe("-0.40%");
    expect(formatPct(0)).toBe("0.00%");
    expect(formatPct(undefined)).toBe("—");
    expect(changeClass(2)).toBe("text-primary");
    expect(changeClass(-2)).toBe("text-destructive");
    expect(changeClass(null)).toBe("text-muted-foreground");
  });

  it("formats counts and mints", () => {
    expect(formatCount(8401)).toBe("8,401");
    expect(formatCount(1_234_567)).toBe("1.23M");
    expect(formatCount(null)).toBe("—");
    expect(shortMint("So11111111111111111111111111111111111111112")).toBe("So11…1112");
  });
});

describe("prepareCandles", () => {
  it("sorts ascending, dedupes by time (last wins) and drops bad rows", () => {
    const out = prepareCandles([
      c(300, 3),
      c(100, 1),
      c(200, 2),
      c(200, 2.5),
      c(400, Number.NaN),
      c(500, 0),
    ]);
    expect(out.map((x) => x.time)).toEqual([100, 200, 300]);
    expect(out[1].close).toBe(2.5);
  });

  it("zeroes negative or missing volume", () => {
    expect(prepareCandles([c(1, 1, { volume: -5 })])[0].volume).toBe(0);
  });
});

describe("liveCandle", () => {
  const last = c(3600, 100, { open: 99, high: 101, low: 98 });

  it("nudges the open bucket", () => {
    const out = liveCandle(last, null, 102, "1h", 3600 + 120);
    expect(out).toEqual({ ...last, close: 102, high: 102, low: 98 });
  });

  it("keeps earlier ticks' extremes within the bucket", () => {
    const first = liveCandle(last, null, 97, "1h", 3700)!;
    const second = liveCandle(last, first, 99.5, "1h", 3800)!;
    expect(second.low).toBe(97);
    expect(second.close).toBe(99.5);
  });

  it("opens the next bucket at the last close", () => {
    const out = liveCandle(last, null, 100.5, "1h", 7200 + 5);
    expect(out).toEqual({ time: 7200, open: 100, high: 100.5, low: 100, close: 100.5, volume: 0 });
  });

  it("skips misaligned buckets, bad prices and outliers", () => {
    expect(liveCandle(last, null, 100, "1h", 7200 * 3)).toBeNull();
    expect(liveCandle(last, null, 0, "1h", 3700)).toBeNull();
    expect(liveCandle(last, null, null, "1h", 3700)).toBeNull();
    expect(liveCandle(last, null, 200, "1h", 3700)).toBeNull();
    expect(liveCandle(undefined, null, 100, "1h", 3700)).toBeNull();
  });

  it("ignores a stale nudged candle from an older bucket", () => {
    const old = c(0, 50);
    expect(liveCandle(last, old, 100, "1h", 3700)?.low).toBe(98);
  });
});

describe("chartPriceFormat", () => {
  it("derives precision from magnitude", () => {
    expect(chartPriceFormat(107)).toEqual({ type: "price", precision: 2, minMove: 0.01 });
    expect(chartPriceFormat(1.5)).toEqual({ type: "price", precision: 4, minMove: 0.0001 });
    expect(chartPriceFormat(0.4123).precision).toBe(4);
    expect(chartPriceFormat(0.00000322)).toEqual({ type: "price", precision: 9, minMove: 1e-9 });
    expect(chartPriceFormat(1e-15).precision).toBe(12);
    expect(chartPriceFormat(null).precision).toBe(2);
  });
});
