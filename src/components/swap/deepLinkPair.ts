import { POPULAR_TOKENS } from "@/lib/constants";
import type { TokenInfo } from "@/lib/tokens/types";

const DEFAULT_INPUT = POPULAR_TOKENS[0]; // SOL
const DEFAULT_OUTPUT = POPULAR_TOKENS[1]; // USDC

export interface DeepLinkPair {
  input: TokenInfo;
  output: TokenInfo;
  /** Requested mints that could not be resolved. */
  missing: string[];
}

function firstOther(candidates: TokenInfo[], mint: string): TokenInfo {
  return candidates.find((t) => t.mint !== mint) ?? candidates[candidates.length - 1];
}

/**
 * Decides the pair to show for /swap?inputMint&outputMint. A requested side
 * that did not resolve falls back to the default pair (SOL -> USDC) instead
 * of silently keeping whatever token was there before. A side that was not
 * requested keeps the current token. Never returns the same mint twice.
 */
export function resolveDeepLinkPair(
  current: { input: TokenInfo; output: TokenInfo },
  requested: { inputMint: string | null; outputMint: string | null },
  found: TokenInfo[]
): DeepLinkPair {
  const { inputMint, outputMint } = requested;
  const foundIn = inputMint ? found.find((t) => t.mint === inputMint) : undefined;
  const foundOut = outputMint ? found.find((t) => t.mint === outputMint) : undefined;
  const missing: string[] = [];
  if (inputMint && !foundIn) missing.push(inputMint);
  if (outputMint && !foundOut) missing.push(outputMint);

  let input = inputMint ? (foundIn ?? DEFAULT_INPUT) : current.input;
  let output = outputMint ? (foundOut ?? DEFAULT_OUTPUT) : current.output;
  if (input.mint === output.mint) {
    // Keep the side the link resolved; replace the other with a default.
    if (foundOut && !foundIn) input = firstOther([DEFAULT_INPUT, DEFAULT_OUTPUT], output.mint);
    else output = firstOther([DEFAULT_OUTPUT, DEFAULT_INPUT], input.mint);
  }
  return { input, output, missing };
}
