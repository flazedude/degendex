import { describe, expect, it } from "vitest";
import { SOL_MINT, USDC_MINT } from "@/lib/constants";
import type { MarketDetail, MarketSummary } from "@/lib/markets/types";
import { baseTokenKey, resolveBaseToken, selectedMintFromParam } from "./baseToken";

const JUP = "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN";

const summary: MarketSummary = {
  mint: JUP,
  symbol: "JUP",
  name: "Jupiter",
  decimals: 6,
  icon: "https://static.jup.ag/jup/icon.png",
  isVerified: true,
  tier: "core",
  priceUsd: 0.4,
  change24hPct: 1,
  volume24hUsd: 1,
  liquidityUsd: 5_000_000,
  mcapUsd: 1,
};

const detail: MarketDetail = {
  ...summary,
  holderCount: 1,
  organicScoreLabel: "high",
  tags: ["verified"],
  tokenProgram: null,
  audit: { mintAuthorityDisabled: true, freezeAuthorityDisabled: true },
  high24hUsd: null,
  low24hUsd: null,
  pool: null,
  updatedAt: 0,
};

describe("selectedMintFromParam", () => {
  it("accepts valid mints and falls back to SOL", () => {
    expect(selectedMintFromParam(JUP)).toBe(JUP);
    expect(selectedMintFromParam(` ${JUP} `)).toBe(JUP);
    expect(selectedMintFromParam(null)).toBe(SOL_MINT);
    expect(selectedMintFromParam("CRYPTO:SOLUSD")).toBe(SOL_MINT);
    expect(selectedMintFromParam("not-a-mint")).toBe(SOL_MINT);
  });
});

describe("resolveBaseToken", () => {
  it("prefers the market detail, including risk fields, without price", () => {
    const t = resolveBaseToken(JUP, detail, summary)!;
    expect(t.decimals).toBe(6);
    expect(t.audit).toEqual(detail.audit);
    expect(t.organicScoreLabel).toBe("high");
    expect(t.liquidity).toBe(5_000_000);
    expect(t.usdPrice).toBeUndefined();
  });

  it("falls back to the curated summary, then popular tokens", () => {
    expect(resolveBaseToken(JUP, undefined, summary)?.decimals).toBe(6);
    expect(resolveBaseToken(USDC_MINT, undefined, undefined)?.decimals).toBe(6);
  });

  it("ignores data for another mint and returns null when decimals are unknown", () => {
    expect(resolveBaseToken(USDC_MINT, detail, summary)?.symbol).toBe("USDC");
    expect(resolveBaseToken("11111111111111111111111111111111", detail, summary)).toBeNull();
  });

  it("drops an unknown organic score label", () => {
    expect(resolveBaseToken(JUP, { ...detail, organicScoreLabel: "weird" }, undefined)?.organicScoreLabel).toBeUndefined();
  });

  it("keys on content, not identity", () => {
    expect(baseTokenKey(resolveBaseToken(JUP, detail, summary))).toBe(
      baseTokenKey(resolveBaseToken(JUP, { ...detail, priceUsd: 9 }, summary))
    );
    expect(baseTokenKey(null)).toBe("");
  });
});
