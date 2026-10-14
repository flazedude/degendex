import { describe, expect, it } from "vitest";
import { BONK_MINT, SOL_MINT, USDC_MINT } from "@/lib/constants";
import { marketOrderTokens, swapPageHref } from "./marketPair";

const bonk = { mint: BONK_MINT, symbol: "BONK", decimals: 5 };
const usdc = { mint: USDC_MINT, symbol: "USDC", decimals: 6 };

describe("marketOrderTokens", () => {
  it("buy pays USDC for the base, sell pays the base for USDC", () => {
    const buy = marketOrderTokens(bonk, "buy");
    expect([buy.input.mint, buy.output.mint, buy.quote.mint]).toEqual([USDC_MINT, BONK_MINT, USDC_MINT]);
    const sell = marketOrderTokens(bonk, "sell");
    expect([sell.input.mint, sell.output.mint]).toEqual([BONK_MINT, USDC_MINT]);
    expect(buy.output).toBe(bonk);
  });

  it("uses SOL as the counter asset when the base is USDC", () => {
    const buy = marketOrderTokens(usdc, "buy");
    expect([buy.input.mint, buy.output.mint, buy.quote.mint]).toEqual([SOL_MINT, USDC_MINT, SOL_MINT]);
    expect(buy.input.decimals).toBe(9);
    const sell = marketOrderTokens(usdc, "sell");
    expect([sell.input.mint, sell.output.mint]).toEqual([USDC_MINT, SOL_MINT]);
  });
});

describe("swapPageHref", () => {
  it("prefills the Swap page", () => {
    expect(swapPageHref(USDC_MINT, BONK_MINT)).toBe(`/swap?inputMint=${USDC_MINT}&outputMint=${BONK_MINT}`);
  });
});
