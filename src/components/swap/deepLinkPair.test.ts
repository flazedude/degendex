import { describe, expect, it } from "vitest";
import { resolveDeepLinkPair } from "./deepLinkPair";
import { BONK_MINT, JUP_MINT, POPULAR_TOKENS, SOL_MINT, USDC_MINT } from "@/lib/constants";

const [SOL, USDC, , JUP, BONK] = POPULAR_TOKENS;
const UNKNOWN = "Unknown1111111111111111111111111111111111111";
const current = { input: JUP, output: BONK };

describe("resolveDeepLinkPair", () => {
  it("applies both resolved sides", () => {
    const r = resolveDeepLinkPair(current, { inputMint: SOL_MINT, outputMint: USDC_MINT }, [SOL, USDC]);
    expect([r.input.mint, r.output.mint, r.missing]).toEqual([SOL_MINT, USDC_MINT, []]);
  });

  it("resets an unresolved output to the default instead of keeping the stale token", () => {
    const r = resolveDeepLinkPair(current, { inputMint: SOL_MINT, outputMint: UNKNOWN }, [SOL]);
    expect([r.input.mint, r.output.mint, r.missing]).toEqual([SOL_MINT, USDC_MINT, [UNKNOWN]]);
  });

  it("falls back to the default pair when the lookup failed", () => {
    const r = resolveDeepLinkPair(current, { inputMint: BONK_MINT, outputMint: UNKNOWN }, []);
    expect([r.input.mint, r.output.mint]).toEqual([SOL_MINT, USDC_MINT]);
    expect(r.missing).toEqual([BONK_MINT, UNKNOWN]);
  });

  it("keeps the resolved side and picks a different default for the other", () => {
    const a = resolveDeepLinkPair(current, { inputMint: USDC_MINT, outputMint: UNKNOWN }, [USDC]);
    expect([a.input.mint, a.output.mint]).toEqual([USDC_MINT, SOL_MINT]);
    const b = resolveDeepLinkPair(current, { inputMint: UNKNOWN, outputMint: SOL_MINT }, [SOL]);
    expect([b.input.mint, b.output.mint]).toEqual([USDC_MINT, SOL_MINT]);
  });

  it("keeps the current token on a side that was not requested", () => {
    const r = resolveDeepLinkPair(current, { inputMint: null, outputMint: SOL_MINT }, [SOL]);
    expect([r.input.mint, r.output.mint]).toEqual([JUP_MINT, SOL_MINT]);
    const clash = resolveDeepLinkPair(current, { inputMint: null, outputMint: JUP_MINT }, [JUP]);
    expect([clash.input.mint, clash.output.mint]).toEqual([SOL_MINT, JUP_MINT]);
    const failed = resolveDeepLinkPair({ input: JUP, output: SOL }, { inputMint: UNKNOWN, outputMint: null }, []);
    expect([failed.input.mint, failed.output.mint]).toEqual([SOL_MINT, USDC_MINT]);
  });
});
