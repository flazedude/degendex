import { POPULAR_TOKENS, SOL_MINT, USDC_MINT } from "@/lib/constants";
import type { TokenInfo } from "@/lib/tokens/types";

export type MarketSide = "buy" | "sell";

const USDC = POPULAR_TOKENS.find((t) => t.mint === USDC_MINT)!;
const SOL = POPULAR_TOKENS.find((t) => t.mint === SOL_MINT)!;

export interface MarketOrderTokens {
  /** What the base is priced in: USDC, or SOL when the base is USDC itself. */
  quote: TokenInfo;
  /** What the user pays. */
  input: TokenInfo;
  /** What the user receives. */
  output: TokenInfo;
}

/** Buy pays the quote for the base; sell pays the base for the quote. */
export function marketOrderTokens(base: TokenInfo, side: MarketSide): MarketOrderTokens {
  const quote = base.mint === USDC_MINT ? SOL : USDC;
  return side === "buy"
    ? { quote, input: quote, output: base }
    : { quote, input: base, output: quote };
}

/** The Swap page prefilled with the same pair. */
export function swapPageHref(inputMint: string, outputMint: string): string {
  const qs = new URLSearchParams({ inputMint, outputMint });
  return `/swap?${qs}`;
}
