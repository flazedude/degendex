import { POPULAR_TOKENS, SOL_MINT } from "@/lib/constants";
import { isValidPubkey } from "@/lib/jupiter/params";
import type { MarketDetail, MarketSummary } from "@/lib/markets/types";
import type { TokenInfo } from "@/lib/tokens/types";

/** `?mint=` when it is a valid Solana address, else SOL (old `?symbol=` links land here too). */
export function selectedMintFromParam(param: string | null): string {
  const v = param?.trim() ?? "";
  return isValidPubkey(v) ? v : SOL_MINT;
}

function organicLabel(v: string | null): TokenInfo["organicScoreLabel"] {
  return v === "high" || v === "medium" || v === "low" ? v : undefined;
}

/**
 * The TokenInfo the order form trades, or null while its decimals are unknown.
 * Decimals only ever come from Jupiter data: the live market detail first
 * (it also carries the audit and liquidity the risk warnings need), then the
 * curated list served by /api/markets, then the app's verified popular tokens
 * (USDC is not a curated market). Price is left out on purpose: the order form
 * quotes from Jupiter, and a ticking price would only churn the object.
 */
export function resolveBaseToken(
  mint: string,
  detail: MarketDetail | undefined,
  summary: MarketSummary | undefined
): TokenInfo | null {
  if (detail && detail.mint === mint && Number.isInteger(detail.decimals)) {
    return {
      mint,
      symbol: detail.symbol,
      name: detail.name || undefined,
      decimals: detail.decimals,
      logoURI: detail.icon,
      isVerified: detail.isVerified,
      tags: detail.tags.length > 0 ? detail.tags : undefined,
      audit: detail.audit ?? undefined,
      organicScoreLabel: organicLabel(detail.organicScoreLabel),
      liquidity: detail.liquidityUsd ?? undefined,
    };
  }
  if (summary && summary.mint === mint && Number.isInteger(summary.decimals)) {
    return {
      mint,
      symbol: summary.symbol,
      name: summary.name || undefined,
      decimals: summary.decimals,
      logoURI: summary.icon,
      isVerified: summary.isVerified,
      liquidity: summary.liquidityUsd ?? undefined,
    };
  }
  const popular = POPULAR_TOKENS.find((t) => t.mint === mint);
  return popular ? { ...popular } : null;
}

/** A key that changes only when a field the order form cares about changes. */
export function baseTokenKey(t: TokenInfo | null): string {
  return t ? JSON.stringify(t) : "";
}
