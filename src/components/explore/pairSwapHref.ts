import { SOL_MINT, USDC_MINT } from "@/lib/constants";
import type { DexScreenerPair } from "@/lib/api/dexscreener";

/**
 * Deep link to the Swap page that buys a DexScreener pair's base token, or null
 * when the pair is not on Solana. Pays with SOL, or with USDC when the base
 * token is SOL itself.
 */
export function pairSwapHref(
  pair: Pick<DexScreenerPair, "chainId" | "baseToken">
): string | null {
  const outputMint = pair.baseToken?.address;
  if (pair.chainId !== "solana" || !outputMint) return null;
  const inputMint = outputMint === SOL_MINT ? USDC_MINT : SOL_MINT;
  return `/swap?${new URLSearchParams({ inputMint, outputMint }).toString()}`;
}
