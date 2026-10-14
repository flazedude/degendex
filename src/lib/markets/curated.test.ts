import { describe, expect, it } from "vitest";
import { isValidPubkey } from "@/lib/jupiter/params";
import { SOL_MINT, USDC_MINT, USDT_MINT } from "@/lib/constants";
import { CURATED_MARKETS, CURATED_MINTS, getCuratedMarket } from "./curated";

describe("curated markets", () => {
  it("has unique, valid mints and no stablecoins", () => {
    expect(CURATED_MARKETS.length).toBeGreaterThanOrEqual(20);
    expect(new Set(CURATED_MINTS).size).toBe(CURATED_MINTS.length);
    expect(CURATED_MINTS.every((m) => isValidPubkey(m))).toBe(true);
    expect(CURATED_MINTS).not.toContain(USDC_MINT);
    expect(CURATED_MINTS).not.toContain(USDT_MINT);
    expect(CURATED_MINTS.length).toBeLessThanOrEqual(50);
  });

  it("has sane metadata and valid hardcoded pools", () => {
    for (const m of CURATED_MARKETS) {
      expect(m.symbol).toMatch(/^\S{1,12}$/);
      expect(Number.isInteger(m.decimals)).toBe(true);
      expect(m.icon).toMatch(/^https:\/\//);
      expect(["core", "ecosystem"]).toContain(m.tier);
      if (m.pool) {
        expect(isValidPubkey(m.pool.address)).toBe(true);
        expect(["USDC", "USDT", "SOL"]).toContain(m.pool.quoteSymbol);
      }
    }
  });

  it("starts with SOL and carries the verified SOL and BONK pools", () => {
    expect(CURATED_MARKETS[0].mint).toBe(SOL_MINT);
    expect(getCuratedMarket(SOL_MINT)?.pool?.address).toBe("Czfq3xZZDmsdGdUyrNLtRhGc47cXcZtLG4crryfu44zE");
    expect(getCuratedMarket("DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263")?.pool?.address).toBe(
      "5zpyutJu9ee6jFymDGoK7F6S5Kczqtc9FomP3ueKuyA9"
    );
  });
});
