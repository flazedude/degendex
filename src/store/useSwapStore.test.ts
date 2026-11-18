import { beforeEach, describe, expect, it } from "vitest";
import { useSwapStore, type TokenInfo } from "./useSwapStore";
import { POPULAR_TOKENS } from "@/lib/constants";

const [SOL, USDC, , , BONK] = POPULAR_TOKENS;
const ZERO_DEC: TokenInfo = { ...BONK, mint: "Zero111111111111111111111111111111111111111", decimals: 0, symbol: "Z" };

const state = () => useSwapStore.getState();

beforeEach(() => {
  useSwapStore.setState({ inputToken: SOL, outputToken: USDC, inputAmount: "" });
});

describe("useSwapStore amount precision", () => {
  it("cuts the amount when a new input token has fewer decimals", () => {
    state().setInputAmount("0.123456789");
    state().setInputToken(BONK);
    expect(state().inputAmount).toBe("0.12345");
  });

  it("cuts the amount when picking the output token as input (flip)", () => {
    state().setInputAmount("1.234567891");
    state().setInputToken(USDC);
    expect(state().inputToken.mint).toBe(USDC.mint);
    expect(state().outputToken.mint).toBe(SOL.mint);
    expect(state().inputAmount).toBe("1.234567");
  });

  it("cuts the amount on the setOutputToken flip branch only", () => {
    state().setInputAmount("1.234567891");
    state().setOutputToken(BONK);
    expect(state().inputAmount).toBe("1.234567891");
    state().setOutputToken(SOL);
    expect(state().inputToken.mint).toBe(BONK.mint);
    expect(state().inputAmount).toBe("1.23456");
  });

  it("cuts the amount in setTokens and drops the fraction for 0 decimals", () => {
    state().setInputAmount("1.5");
    state().setTokens(ZERO_DEC, USDC);
    expect(state().inputAmount).toBe("1");
    state().setInputAmount("0.5");
    state().setTokens(SOL, ZERO_DEC);
    expect(state().inputAmount).toBe("0.5");
  });

  it("switchTokens keeps a seeded amount and otherwise cuts the old one", () => {
    state().setInputAmount("0.123456789");
    state().switchTokens();
    expect(state().inputToken.mint).toBe(USDC.mint);
    expect(state().inputAmount).toBe("0.123456");
    state().switchTokens("42.1234567");
    expect(state().inputAmount).toBe("42.1234567");
  });
});
