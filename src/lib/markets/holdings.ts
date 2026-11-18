// Pure helpers for wallet holdings (unit tested; no RPC or React here).
import BigNumber from "bignumber.js";
import { SOL_MINT } from "@/lib/constants";
import type { WalletHolding } from "./types";

/** mint -> summed raw amount (base units) and the mint's decimals. */
export type TokenHoldingMap = Record<string, { raw: string; decimals: number }>;

/** The parts of a getParsedTokenAccountsByOwner result we read. */
export interface ParsedTokenAccountsResult {
  value: ReadonlyArray<{ account: { data: unknown } }>;
}

/**
 * Sums parsed Token / Token-2022 accounts per mint (an owner can hold several
 * accounts of one mint), keeping the decimals from the parsed account.
 * Malformed accounts are skipped. Zero balances are included.
 */
export function sumTokenAccounts(results: readonly ParsedTokenAccountsResult[]): TokenHoldingMap {
  const sums: Record<string, { sum: BigNumber; decimals: number | null }> = {};
  for (const { value } of results) {
    for (const { account } of value) {
      const data = account.data;
      if (!data || typeof data !== "object" || !("parsed" in data)) continue;
      const info = (data.parsed as {
        info?: { mint?: unknown; tokenAmount?: { amount?: unknown; decimals?: unknown } };
      } | null)?.info;
      const mint = info?.mint;
      const amount = info?.tokenAmount?.amount;
      const decimals = info?.tokenAmount?.decimals;
      if (typeof mint !== "string" || typeof amount !== "string") continue;
      if (!/^\d+$/.test(amount)) continue;
      const validDecimals =
        typeof decimals === "number" && Number.isInteger(decimals) && decimals >= 0 && decimals <= 255
          ? decimals
          : null;
      const prev = sums[mint];
      sums[mint] = {
        sum: (prev?.sum ?? new BigNumber(0)).plus(amount),
        decimals: validDecimals ?? prev?.decimals ?? null,
      };
    }
  }
  const out: TokenHoldingMap = {};
  for (const [mint, { sum, decimals }] of Object.entries(sums)) {
    // Decimals are needed to display an amount; without them the row is unusable.
    if (decimals === null) continue;
    out[mint] = { raw: sum.toFixed(0), decimals };
  }
  return out;
}

/**
 * Wallet holdings: native SOL first (as SOL_MINT, 9 decimals, listed even at
 * zero), then every SPL holding with a non-zero balance, sorted by mint.
 * Wrapped-SOL token accounts are left out: the swap spends native SOL, so
 * SOL_MINT means the native balance (as in useTokenBalance).
 */
export function buildHoldings(solLamports: string | undefined, spl: TokenHoldingMap | undefined): WalletHolding[] {
  const out: WalletHolding[] = [];
  if (solLamports !== undefined && /^\d+$/.test(solLamports)) {
    out.push({ mint: SOL_MINT, raw: solLamports, decimals: 9 });
  }
  if (spl) {
    for (const mint of Object.keys(spl).sort()) {
      if (mint === SOL_MINT) continue;
      const h = spl[mint];
      if (!/^\d+$/.test(h.raw) || /^0+$/.test(h.raw)) continue;
      out.push({ mint, raw: h.raw, decimals: h.decimals });
    }
  }
  return out;
}
