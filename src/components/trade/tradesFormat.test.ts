import { describe, expect, it } from "vitest";
import {
  TRADES_DELAYED_AFTER_MS,
  dexLabel,
  formatCompactAmount,
  formatPct,
  formatPrice,
  formatUsdPrice,
  formatUsdValue,
  geckoPoolUrl,
  isTradesDelayed,
  solscanTxUrl,
  timeAgo,
} from "./tradesFormat";

describe("formatPrice", () => {
  it("scales decimals with magnitude", () => {
    expect(formatPrice(98765.4321)).toBe("98,765.43");
    expect(formatPrice(1234.5)).toBe("1,234.50");
    expect(formatPrice(106.94)).toBe("106.94");
    expect(formatPrice(12.34567)).toBe("12.346");
    expect(formatPrice(1.23456)).toBe("1.2346");
    expect(formatPrice(0.41234)).toBe("0.4123");
    expect(formatPrice(0.05)).toBe("0.05000");
    expect(formatPrice(0.001234)).toBe("0.001234");
    expect(formatPrice(0.0001234)).toBe("0.0001234");
  });

  it("uses subscript zeros for tiny prices", () => {
    expect(formatPrice(0.00000322)).toBe("0.0₅3220");
    expect(formatPrice(0.0000123456)).toBe("0.0₄1235");
    expect(formatPrice(1.5e-12)).toBe("0.0₁₁1500");
  });

  it("never prints exponent notation and handles bad input", () => {
    expect(formatPrice(1e-8)).not.toMatch(/e/i);
    expect(formatPrice(0)).toBe("0");
    expect(formatPrice(-2.5)).toBe("-2.5000");
    expect(formatPrice(null)).toBe("—");
    expect(formatPrice(undefined)).toBe("—");
    expect(formatPrice(NaN)).toBe("—");
    expect(formatPrice(Infinity)).toBe("—");
  });

  it("formatUsdPrice prefixes $", () => {
    expect(formatUsdPrice(106.94)).toBe("$106.94");
    expect(formatUsdPrice(-1)).toBe("-$1.0000");
    expect(formatUsdPrice(null)).toBe("—");
  });
});

describe("formatCompactAmount", () => {
  it("compacts large amounts and keeps precision on small ones", () => {
    expect(formatCompactAmount(1_234_567)).toBe("1.23M");
    expect(formatCompactAmount(25_400)).toBe("25.4K");
    expect(formatCompactAmount(9_999.5)).toBe("9,999.5");
    expect(formatCompactAmount(24.0612345)).toBe("24.0612");
    expect(formatCompactAmount(0.012349)).toBe("0.01234");
    expect(formatCompactAmount(0)).toBe("0");
    expect(formatCompactAmount(1e-12)).toBe("<0.000000001");
    expect(formatCompactAmount(NaN)).toBe("—");
  });
});

describe("formatUsdValue", () => {
  it("formats cents, compact and dust", () => {
    expect(formatUsdValue(2572.4)).toBe("$2,572.40");
    expect(formatUsdValue(1_250_000)).toBe("$1.25M");
    expect(formatUsdValue(0.004)).toBe("<$0.01");
    expect(formatUsdValue(0)).toBe("$0.00");
    expect(formatUsdValue(null)).toBe("—");
  });
});

describe("formatPct", () => {
  it("signs the change", () => {
    expect(formatPct(1.234)).toBe("+1.23%");
    expect(formatPct(-0.4)).toBe("-0.40%");
    expect(formatPct(0)).toBe("0.00%");
    expect(formatPct(null)).toBe("—");
  });
});

describe("timeAgo", () => {
  const now = 1_700_000_000_000;
  it("buckets ages", () => {
    expect(timeAgo(now, now)).toBe("now");
    expect(timeAgo(now + 5_000, now)).toBe("now");
    expect(timeAgo(now - 12_000, now)).toBe("12s");
    expect(timeAgo(now - 3 * 60_000, now)).toBe("3m");
    expect(timeAgo(now - 2 * 3_600_000, now)).toBe("2h");
    expect(timeAgo(now - 4 * 86_400_000, now)).toBe("4d");
  });
  it("returns a dash without a clock", () => {
    expect(timeAgo(now, 0)).toBe("—");
    expect(timeAgo(NaN, now)).toBe("—");
  });
});

describe("dexLabel", () => {
  it("humanises GeckoTerminal dex ids", () => {
    expect(dexLabel("orca")).toBe("Orca");
    expect(dexLabel("raydium-clmm")).toBe("Raydium CLMM");
    expect(dexLabel("meteora-dlmm")).toBe("Meteora DLMM");
    expect(dexLabel("pump_amm")).toBe("Pump AMM");
    expect(dexLabel("unknown")).toBeNull();
    expect(dexLabel("")).toBeNull();
    expect(dexLabel(null)).toBeNull();
  });
});

describe("links", () => {
  const sig = "5VERv8NMvzbJMEkV8xnrLkEaWRtSz9CosKDYjCJjBRnbJLgp8uirBgmQpjKhoR4tjF3ZpRzrFmBV6UjKdiSZkQUW";
  it("builds Solscan links only for base58 signatures", () => {
    expect(solscanTxUrl(sig)).toBe(`https://solscan.io/tx/${sig}`);
    expect(solscanTxUrl("javascript:alert(1)")).toBeNull();
    expect(solscanTxUrl("0OIl")).toBeNull();
    expect(solscanTxUrl(undefined)).toBeNull();
  });
  it("builds GeckoTerminal pool links only for pubkeys", () => {
    expect(geckoPoolUrl("Czfq3xZZDmsdGdUyrNLtRhGc47cXcZtLG4crryfu44zE")).toBe(
      "https://www.geckoterminal.com/solana/pools/Czfq3xZZDmsdGdUyrNLtRhGc47cXcZtLG4crryfu44zE"
    );
    expect(geckoPoolUrl("../evil")).toBeNull();
    expect(geckoPoolUrl(null)).toBeNull();
  });
});

describe("isTradesDelayed", () => {
  const now = 1_700_000_000_000;
  it("flags server-stale, failed refetches and old copies", () => {
    expect(isTradesDelayed(undefined, false, now)).toBe(false);
    expect(isTradesDelayed({ updatedAt: now - 30_000 }, false, now)).toBe(false);
    expect(isTradesDelayed({ updatedAt: now - 30_000, stale: true }, false, now)).toBe(true);
    expect(isTradesDelayed({ updatedAt: now - 30_000 }, true, now)).toBe(true);
    expect(isTradesDelayed({ updatedAt: now - TRADES_DELAYED_AFTER_MS - 1 }, false, now)).toBe(true);
  });
  it("does not guess age without a clock", () => {
    expect(isTradesDelayed({ updatedAt: 1 }, false, 0)).toBe(false);
  });
});
