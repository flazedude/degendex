// Pure builder for the terminal's Balances tab (unit tested; no React here).
import BigNumber from "bignumber.js";
import { formatTokenAmount, fromBaseUnits } from "@/lib/amounts";
import type { TriggerOrderRow } from "@/lib/jupiter/trigger/types";
import type { WalletHolding } from "@/lib/markets/types";
import type { TokenInfo } from "@/lib/tokens/types";
import { shortenAddress } from "@/lib/utils";

/** Balances worth less than this (USD) are tucked behind "Show small/unknown tokens". */
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
  /**
   * Hidden behind the small/unknown toggle: zero, priced under DUST_USD, or
   * unpriced and one of: NFT-like (see isNftLike), not listed by Jupiter (once
   * metadata loaded), unverified (once prices loaded). Never hidden for lack of
   * data alone: with metadata or prices unavailable, unpriced rows stay visible.
   */
  isDust: boolean;
  isCurrent: boolean;
}

export interface BalancePrice {
  usdPrice: number;
  change24hPct: number | null;
}

/** A single unit of a 0-decimal mint: legacy NFTs and many spam airdrops. */
export function isNftLike(h: Pick<WalletHolding, "raw" | "decimals">): boolean {
  return h.decimals === 0 && h.raw === "1";
}

/**
 * Builds the wallet rows. `metadata` / `prices` are undefined while loading or
 * after a failure; only loaded data can hide a row as unknown / unverified.
 */
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
    const hiddenUnpriced =
      valueUsd === null &&
      (isNftLike(h) ||
        (metadata !== undefined && !meta) ||
        (prices !== undefined && !!meta && meta.isVerified !== true));
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
      isDust: zero || (valueUsd !== null && valueUsd < DUST_USD) || hiddenUnpriced,
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
export function totalValueUsd(rows: readonly { valueUsd: number | null }[]): number | null {
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

// --- Funds held in the Jupiter vault for limit / DCA orders -----------------

/** One input mint held by Jupiter for the wallet's orders (summed over orders). */
export interface VaultRow {
  mint: string;
  symbol: string;
  logoURI?: string;
  /** Base units still held (sum of the orders' remaining input). */
  raw: string;
  /** Exact UI amount, null when the mint's decimals are unknown. */
  ui: string | null;
  /** Formatted amount ("—" when decimals are unknown: never guessed). */
  balance: string;
  priceUsd: number | null;
  /** Display-only USD value. */
  valueUsd: number | null;
  /** Orders holding this mint. */
  orders: number;
}

type VaultOrder = Pick<TriggerOrderRow, "id" | "family" | "inputMint" | "inputAmountRemaining">;

const DIGITS = /^\d+$/;

/**
 * Remaining input of the given orders (active + waiting for withdraw), per
 * mint. An order listed in both groups is counted once; orders with nothing
 * left (or an unparseable amount) are skipped. Sorted by value desc, unpriced
 * last.
 */
export function buildVaultRows(
  orders: readonly VaultOrder[],
  decimalsOf: (mint: string) => number | undefined,
  metadata: Readonly<Record<string, TokenInfo>> | undefined,
  prices: Readonly<Record<string, BalancePrice>> | undefined
): VaultRow[] {
  const seen = new Set<string>();
  const byMint = new Map<string, { raw: BigNumber; orders: number }>();
  for (const o of orders) {
    const key = `${o.family}:${o.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (!DIGITS.test(o.inputAmountRemaining)) continue;
    const raw = new BigNumber(o.inputAmountRemaining);
    if (raw.lte(0)) continue;
    const acc = byMint.get(o.inputMint) ?? { raw: new BigNumber(0), orders: 0 };
    byMint.set(o.inputMint, { raw: acc.raw.plus(raw), orders: acc.orders + 1 });
  }
  const rows = [...byMint].map(([mint, acc]): VaultRow => {
    const meta = metadata?.[mint];
    const decimals = decimalsOf(mint);
    const raw = acc.raw.toFixed(0);
    const ui =
      typeof decimals === "number" && Number.isInteger(decimals) && decimals >= 0
        ? fromBaseUnits(raw, decimals)
        : null;
    const p = prices?.[mint];
    const priceUsd = p && Number.isFinite(p.usdPrice) && p.usdPrice >= 0 ? p.usdPrice : null;
    return {
      mint,
      symbol: meta?.symbol || shortenAddress(mint),
      logoURI: meta?.logoURI,
      raw,
      ui,
      balance: ui === null ? "—" : formatTokenAmount(ui),
      priceUsd,
      valueUsd: ui === null || priceUsd === null ? null : new BigNumber(ui).times(priceUsd).toNumber(),
      orders: acc.orders,
    };
  });
  return rows.sort((a, b) => {
    if (a.valueUsd !== null && b.valueUsd !== null && a.valueUsd !== b.valueUsd) return b.valueUsd - a.valueUsd;
    if (a.valueUsd === null && b.valueUsd !== null) return 1;
    if (a.valueUsd !== null && b.valueUsd === null) return -1;
    return a.symbol.localeCompare(b.symbol) || a.mint.localeCompare(b.mint);
  });
}
