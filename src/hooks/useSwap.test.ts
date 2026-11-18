import { describe, expect, it } from "vitest";
import { BONK_MINT, SOL_MINT, USDC_MINT } from "@/lib/constants";
import { toBaseUnits } from "@/lib/amounts";
import { buildQuoteRequest, resolveSwapSource, type SwapSource } from "./useSwap";

const noop = () => {};
const sol = { mint: SOL_MINT, symbol: "SOL", decimals: 9 };
const usdc = { mint: USDC_MINT, symbol: "USDC", decimals: 6 };
const bonk = { mint: BONK_MINT, symbol: "BONK", decimals: 5 };
const store: SwapSource = { inputToken: sol, outputToken: usdc, inputAmount: "1.5", setInputAmount: noop };

/** Mirrors useSwap: source (or store) -> base units -> request. */
function requestFor(source: SwapSource | undefined, taker?: string) {
  const s = resolveSwapSource(source, store);
  return buildQuoteRequest({
    inputMint: s.inputToken.mint,
    outputMint: s.outputToken.mint,
    rawAmount: toBaseUnits(s.inputAmount, s.inputToken.decimals),
    taker,
    slippage: "auto",
  });
}

describe("resolveSwapSource", () => {
  it("falls back to the store without a source", () => {
    expect(resolveSwapSource(undefined, store)).toBe(store);
  });

  it("uses the provided source and ignores the store entirely", () => {
    const setter = () => {};
    const terminal: SwapSource = { inputToken: usdc, outputToken: bonk, inputAmount: "25", setInputAmount: setter };
    const s = resolveSwapSource(terminal, store);
    expect(s).toBe(terminal);
    expect(s.setInputAmount).toBe(setter);
  });
});

describe("request key", () => {
  it("derives from the store when no source is given", () => {
    expect(requestFor(undefined)?.key).toBe(`${SOL_MINT}|${USDC_MINT}|1500000000||auto`);
  });

  it("derives from the provided source (pair, amount and decimals)", () => {
    const req = requestFor(
      { inputToken: usdc, outputToken: bonk, inputAmount: "25", setInputAmount: noop },
      "Taker1111111111111111111111111111111111111"
    );
    expect(req).toEqual({
      key: `${USDC_MINT}|${BONK_MINT}|25000000|Taker1111111111111111111111111111111111111|auto`,
      inputMint: USDC_MINT,
      outputMint: BONK_MINT,
      amount: "25000000",
      taker: "Taker1111111111111111111111111111111111111",
      slippageBps: undefined,
    });
  });

  it("is null for an empty source amount even when the store has one", () => {
    expect(requestFor({ inputToken: usdc, outputToken: bonk, inputAmount: "", setInputAmount: noop })).toBeNull();
  });

  it("is null for the same mint on both sides", () => {
    expect(requestFor({ inputToken: usdc, outputToken: usdc, inputAmount: "1", setInputAmount: noop })).toBeNull();
  });
});

describe("buildQuoteRequest", () => {
  it("includes a fixed slippage in the key and request", () => {
    const req = buildQuoteRequest({
      inputMint: SOL_MINT,
      outputMint: USDC_MINT,
      rawAmount: "1",
      taker: undefined,
      slippage: 50,
    });
    expect(req?.key).toBe(`${SOL_MINT}|${USDC_MINT}|1||50`);
    expect(req?.slippageBps).toBe(50);
  });
});
