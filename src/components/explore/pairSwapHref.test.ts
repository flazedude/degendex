import { describe, expect, it } from "vitest";
import { SOL_MINT, USDC_MINT } from "@/lib/constants";
import { pairSwapHref } from "./pairSwapHref";

const BONK = "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263";

function pair(chainId: string, address: string) {
  return { chainId, baseToken: { address, name: "Token", symbol: "TKN" } };
}

describe("pairSwapHref", () => {
  it("buys a Solana base token with SOL", () => {
    expect(pairSwapHref(pair("solana", BONK))).toBe(
      `/swap?inputMint=${SOL_MINT}&outputMint=${BONK}`
    );
  });

  it("pays with USDC when the base token is SOL", () => {
    expect(pairSwapHref(pair("solana", SOL_MINT))).toBe(
      `/swap?inputMint=${USDC_MINT}&outputMint=${SOL_MINT}`
    );
  });

  it("returns null for pairs on other chains", () => {
    expect(pairSwapHref(pair("ethereum", "0x6982508145454ce325ddbe47a25d4ec3d2311933"))).toBeNull();
  });

  it("returns null when the base token address is missing", () => {
    expect(pairSwapHref(pair("solana", ""))).toBeNull();
  });
});
