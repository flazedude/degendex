// Display helpers for the trades and balances panels. Pure (unit tested).
// Prices and USD values here are display-only floats; token amounts that come
// from the wallet go through BigNumber in balanceRows.ts instead.
import BigNumber from "bignumber.js";

const SUBSCRIPT = ["₀", "₁", "₂", "₃", "₄", "₅", "₆", "₇", "₈", "₉"];

function subscript(n: number): string {
  return String(n)
    .split("")
    .map((d) => SUBSCRIPT[Number(d)] ?? d)
    .join("");
}

/**
 * Magnitude-aware USD price without the "$": 1,234.56 / 106.94 / 1.2345 /
 * 0.4123 / 0.001234 / 0.0₅3220 (subscript = number of zeros after the point,
 * used from 4 zeros on so tiny meme prices stay readable).
 */
export function formatPrice(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  if (value === 0) return "0";
  const neg = value < 0;
  const abs = Math.abs(value);
  let out: string;
  if (abs >= 1000) {
    out = new BigNumber(abs).decimalPlaces(2, BigNumber.ROUND_HALF_UP).toFormat(2);
  } else if (abs >= 1) {
    const dp = abs >= 100 ? 2 : abs >= 10 ? 3 : 4;
    out = new BigNumber(abs).decimalPlaces(dp, BigNumber.ROUND_HALF_UP).toFixed(dp);
  } else {
    const fixed = new BigNumber(abs).precision(4, BigNumber.ROUND_HALF_UP).toFixed();
    const frac = fixed.split(".")[1] ?? "";
    const zeros = frac.length - frac.replace(/^0+/, "").length;
    if (zeros >= 4) {
      const digits = frac.slice(zeros).padEnd(4, "0");
      out = `0.0${subscript(zeros)}${digits}`;
    } else {
      // Keep 4 significant digits, padded so a price column lines up.
      out = new BigNumber(abs).toFixed(zeros + 4, BigNumber.ROUND_HALF_UP);
    }
  }
  return neg ? `-${out}` : out;
}

/** "$" + formatPrice, or "—" when unknown. */
export function formatUsdPrice(value: number | null | undefined): string {
  const p = formatPrice(value);
  if (p === "—") return p;
  return p.startsWith("-") ? `-$${p.slice(1)}` : `$${p}`;
}

const compactFmt = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 2,
});

/** Compact display amount (token units, display only): 1.23M / 12.5K / 24.06 / 0.0123. */
export function formatCompactAmount(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  if (value === 0) return "0";
  const abs = Math.abs(value);
  if (abs >= 10_000) return compactFmt.format(value);
  if (abs >= 1) {
    return new Intl.NumberFormat("en-US", { maximumFractionDigits: abs >= 100 ? 2 : 4 }).format(value);
  }
  if (abs < 1e-9) return value < 0 ? "-<0.000000001" : "<0.000000001";
  return new BigNumber(value).precision(4, BigNumber.ROUND_DOWN).toFixed();
}

/** USD value: $2,572.40 below $100k, compact above ($1.25M), "<$0.01" for dust. */
export function formatUsdValue(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  const abs = Math.abs(value);
  if (abs >= 100_000) {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      notation: "compact",
      maximumFractionDigits: 2,
    }).format(value);
  }
  if (abs > 0 && abs < 0.01) return value < 0 ? "-<$0.01" : "<$0.01";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

/** "+1.23%" / "-0.40%" / "—". */
export function formatPct(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(2)}%`;
}

/** Relative age: "now", "12s", "3m", "2h", "4d". Future timestamps read "now". */
export function timeAgo(tsMs: number, nowMs: number): string {
  if (!Number.isFinite(tsMs) || !Number.isFinite(nowMs) || nowMs <= 0) return "—";
  const s = Math.floor((nowMs - tsMs) / 1000);
  if (s < 1) return "now";
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

const DEX_ACRONYMS = new Set(["amm", "clmm", "cpmm", "dlmm", "damm", "v2", "v3", "v4", "dex", "lb"]);

/** GeckoTerminal dex id -> label: "raydium-clmm" -> "Raydium CLMM". null for unknown. */
export function dexLabel(dex: string | null | undefined): string | null {
  if (typeof dex !== "string") return null;
  const id = dex.trim();
  if (!id || id === "unknown") return null;
  return id
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((w) => (DEX_ACRONYMS.has(w.toLowerCase()) ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(" ");
}

const BASE58_SIG = /^[1-9A-HJ-NP-Za-km-z]{32,100}$/;

/** Solscan tx link, or null when the hash does not look like a Solana signature. */
export function solscanTxUrl(txHash: string | null | undefined): string | null {
  if (typeof txHash !== "string" || !BASE58_SIG.test(txHash)) return null;
  return `https://solscan.io/tx/${txHash}`;
}

/** GeckoTerminal pool page (attribution link), or null for an invalid address. */
export function geckoPoolUrl(address: string | null | undefined): string | null {
  if (typeof address !== "string" || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address)) return null;
  return `https://www.geckoterminal.com/solana/pools/${address}`;
}

/** Older than this (server fetch time), trades are labelled "Delayed" even if not flagged stale. */
export const TRADES_DELAYED_AFTER_MS = 3 * 60_000;

/**
 * True when the trades on screen should not be presented as live: the server
 * served stale cache, the latest refetch failed (react-query keeps the old
 * data), or the server copy is older than TRADES_DELAYED_AFTER_MS.
 */
export function isTradesDelayed(
  data: { updatedAt: number; stale?: boolean } | undefined,
  refetchFailed: boolean,
  nowMs: number
): boolean {
  if (!data) return false;
  if (data.stale === true || refetchFailed) return true;
  if (!Number.isFinite(data.updatedAt) || nowMs <= 0) return false;
  return nowMs - data.updatedAt > TRADES_DELAYED_AFTER_MS;
}
