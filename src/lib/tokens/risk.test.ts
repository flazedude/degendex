import { describe, expect, it } from "vitest";
import { getTokenWarnings, hasDanger } from "./risk";
import { POPULAR_TOKENS, SOL_MINT, USDC_MINT, USDT_MINT } from "@/lib/constants";

const MINT = "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263";
const safe = {
  mint: MINT,
  isVerified: true,
  audit: { mintAuthorityDisabled: true, freezeAuthorityDisabled: true, topHoldersPercentage: 20 },
  organicScoreLabel: "high" as const,
  liquidity: 5_000_000,
};

describe("getTokenWarnings", () => {
  it("returns nothing for a clean token", () => {
    expect(getTokenWarnings(safe)).toEqual([]);
  });

  it("flags unverified", () => {
    expect(getTokenWarnings({ ...safe, isVerified: false })).toEqual([
      { level: "warning", message: "Not verified by Jupiter" },
    ]);
    expect(getTokenWarnings({ ...safe, isVerified: undefined })[0].level).toBe("warning");
  });

  it("flags active mint/freeze authority on unverified tokens as danger (explicit false or missing)", () => {
    const w = getTokenWarnings({
      ...safe,
      isVerified: false,
      audit: { mintAuthorityDisabled: false, topHoldersPercentage: 10 },
    });
    expect(w.filter((x) => x.level === "danger").map((x) => x.message)).toEqual([
      "Mint authority active: supply can be inflated",
      "Freeze authority active: your tokens can be frozen",
    ]);
    expect(hasDanger(w)).toBe(true);
    expect(hasDanger(getTokenWarnings({ mint: MINT, audit: {} }))).toBe(true);
  });

  it("downgrades active authorities on verified tokens to neutral warnings", () => {
    const w = getTokenWarnings({ ...safe, audit: { mintAuthorityDisabled: false, topHoldersPercentage: 10 } });
    expect(w).toEqual([
      { level: "warning", message: "Issuer/program can mint more supply" },
      { level: "warning", message: "Issuer can freeze token accounts" },
    ]);
    expect(hasDanger(w)).toBe(false);
  });

  it("flags concentration, low organic score and low liquidity", () => {
    const w = getTokenWarnings({
      ...safe,
      audit: { ...safe.audit, topHoldersPercentage: 72.4 },
      organicScoreLabel: "low",
      liquidity: 4_321.9,
    });
    expect(w.map((x) => x.message)).toEqual([
      "Top holders own 72% of supply",
      "Low organic trading activity",
      "Very low liquidity ($4,321)",
    ]);
    expect(hasDanger(w)).toBe(false);
    expect(getTokenWarnings({ ...safe, audit: { ...safe.audit, topHoldersPercentage: 50 } })).toEqual([]);
    expect(getTokenWarnings({ ...safe, liquidity: 10_000 })).toEqual([]);
  });

  it("reports missing audit data as info only", () => {
    expect(getTokenWarnings({ ...safe, audit: undefined })).toEqual([
      { level: "info", message: "No audit data available" },
    ]);
  });

  it("sorts danger first", () => {
    const w = getTokenWarnings({ mint: MINT, audit: {}, organicScoreLabel: "low" });
    expect(w[0].level).toBe("danger");
    expect(w[w.length - 1].level).toBe("warning");
  });

  it("never warns for SOL/USDC/USDT, even without audit fields", () => {
    // Shapes as returned live by Jupiter: USDC/USDT omit the authority flags.
    for (const mint of [SOL_MINT, USDC_MINT, USDT_MINT]) {
      expect(getTokenWarnings({ mint, isVerified: true, audit: { topHoldersPercentage: 30 } })).toEqual([]);
      expect(getTokenWarnings({ mint })).toEqual([]);
    }
  });

  it("does not trust verification tags alone for authority flags", () => {
    const w = getTokenWarnings({ ...safe, audit: { mintAuthorityDisabled: true } });
    expect(w).toEqual([{ level: "warning", message: "Issuer can freeze token accounts" }]);
  });

  it("produces no danger for the built-in popular tokens", () => {
    for (const t of POPULAR_TOKENS) expect(hasDanger(getTokenWarnings(t)), t.symbol).toBe(false);
  });

  it("handles null", () => {
    expect(getTokenWarnings(null)).toEqual([]);
  });
});
