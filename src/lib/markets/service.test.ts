import { describe, expect, it } from "vitest";
import { SOL_MINT } from "@/lib/constants";
import { CURATED_MARKETS } from "./curated";
import { highLow24h, mergeMarkets } from "./service";
import type { JupiterTokenStats } from "./jupiter";

const c = (time: number, high: number, low: number) => ({ time, open: low, high, low, close: high, volume: 1 });

describe("highLow24h", () => {
  const now = Date.parse("2026-10-14T06:30:00Z");
  const bucket = Math.floor(now / 1000 / 3600) * 3600;

  it("uses the 24 hourly buckets ending with the open one", () => {
    const candles = [c(bucket - 24 * 3600, 999, 1), c(bucket - 23 * 3600, 5, 4), c(bucket, 6, 3)];
    expect(highLow24h(candles, now)).toEqual({ high: 6, low: 3 });
  });

  it("is null without recent candles", () => {
    expect(highLow24h([], now)).toBeNull();
    expect(highLow24h([c(bucket - 48 * 3600, 2, 1)], now)).toBeNull();
  });
});

describe("mergeMarkets", () => {
  const stats = (patch: Partial<JupiterTokenStats>): JupiterTokenStats => ({
    mint: SOL_MINT,
    symbol: "SOL",
    name: "Wrapped SOL",
    decimals: 9,
    isVerified: true,
    tokenProgram: null,
    holderCount: null,
    organicScoreLabel: null,
    tags: [],
    audit: null,
    usdPrice: 106,
    change24hPct: -2,
    volume24hUsd: 3.5e9,
    liquidityUsd: 9e8,
    mcapUsd: 6.3e10,
    ...patch,
  });

  it("keeps curated order and display metadata, merging by mint", () => {
    const out = mergeMarkets({ [SOL_MINT]: { usdPrice: 107, change24hPct: null } }, { [SOL_MINT]: stats({}) });
    expect(out.map((m) => m.mint)).toEqual(CURATED_MARKETS.map((m) => m.mint));
    expect(out[0]).toMatchObject({
      symbol: "SOL",
      name: "Solana",
      priceUsd: 107,
      // Price v3 had no 24h change: fall back to the stats figure.
      change24hPct: -2,
      volume24hUsd: 3.5e9,
      mcapUsd: 6.3e10,
    });
    expect(out[1]).toMatchObject({ priceUsd: null, volume24hUsd: null, isVerified: true });
  });

  it("falls back to the stats price when prices are unavailable", () => {
    const out = mergeMarkets(null, { [SOL_MINT]: stats({}) });
    expect(out[0].priceUsd).toBe(106);
    expect(mergeMarkets(null, null)[0].priceUsd).toBeNull();
  });
});
