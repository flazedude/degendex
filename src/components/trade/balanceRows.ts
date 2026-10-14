// Pure builder for the terminal's Balances tab (unit tested; no React here).
import BigNumber from "bignumber.js";
import { formatTokenAmount, fromBaseUnits } from "@/lib/amounts";
import type { WalletHolding } from "@/lib/markets/types";
import type { TokenInfo } from "@/lib/tokens/types";
import { shortenAddress } from "@/lib/utils";

/** Balances worth less than this (USD) are tucked behind "Show small balances". */
export const DUST_USD = 0.01;

export interface BalanceRow {
  mint: string;
  /** Jupiter symbol, or the shortened mint when the token is unknown. */
  symbol: string;
  name?: string;
  logoURI?: string;
  /** Jupiter returned metadata for this mint. */
  known: boolean;
  isVerified: boolean;
  /** Exact UI amount (decimal string, from base units via BigNumber). */
  ui: string;
  /** Formatted balance for display. */
  balance: string;
  priceUsd: number | null;
  /** Display-only USD value (float is fine here, never fed back into amounts). */
  valueUsd: number | null;
  change24hPct: number | null;
  /** Zero balance, or a priced balance under DUST_USD. Unpriced non-zero balances are not dust. */
  isDust: boolean;
  isCurrent: boolean;
}

export interface BalancePrice {
  usdPrice: number;
  change24hPct: number | null;
}

export function buildBalanceRows(
  holdings: readonly WalletHolding[],
  metadata: Readonly<Record<string, TokenInfo>> | undefined,
  prices: Readonly<Record<string, BalancePrice>> | undefined,
  currentMint: string | null
): BalanceRow[] {
  const rows = holdings.map((h): BalanceRow => {
    const meta = metadata?.[h.mint];
    const ui = fromBaseUnits(h.raw, h.decimals);
    const amount = new BigNumber(ui);
    const p = prices?.[h.mint];
    const priceUsd = p && Number.isFinite(p.usdPrice) && p.usdPrice >= 0 ? p.usdPrice : null;
    const valueUsd = priceUsd === null ? null : amount.times(priceUsd).toNumber();
    const zero = !amount.isFinite() || amount.lte(0);
    return {
      mint: h.mint,
      symbol: meta?.symbol || shortenAddress(h.mint),
      name: meta?.name,
      logoURI: meta?.logoURI,
      known: !!meta,
      isVerified: meta?.isVerified === true,
      ui,
      balance: formatTokenAmount(ui),
      priceUsd,
      valueUsd,
      change24hPct:
        p && typeof p.change24hPct === "number" && Number.isFinite(p.change24hPct) ? p.change24hPct : null,
      isDust: zero || (valueUsd !== null && valueUsd < DUST_USD),
      isCurrent: h.mint === currentMint,
    };
  });
  return rows.sort(compareRows);
}

/** Value desc; unpriced rows after priced ones, then by symbol and mint (stable). */
function compareRows(a: BalanceRow, b: BalanceRow): number {
  if (a.valueUsd !== null && b.valueUsd !== null && a.valueUsd !== b.valueUsd) return b.valueUsd - a.valueUsd;
  if (a.valueUsd === null && b.valueUsd !== null) return 1;
  if (a.valueUsd !== null && b.valueUsd === null) return -1;
  // Known tokens before unknown ones among the unpriced.
  if (a.known !== b.known) return a.known ? -1 : 1;
  return a.symbol.localeCompare(b.symbol) || a.mint.localeCompare(b.mint);
}

/** Sum of the priced rows (display only), or null when nothing is priced. */
export function totalValueUsd(rows: readonly BalanceRow[]): number | null {
  let total = 0;
  let any = false;
  for (const r of rows) {
    if (r.valueUsd !== null) {
      total += r.valueUsd;
      any = true;
    }
  }
  return any ? total : null;
}
