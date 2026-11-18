// Display helpers for the /trade terminal. Market data (USD prices, volumes)
// arrives as JSON numbers and is display-only here; token amounts that feed a
// transaction never pass through these helpers.

import { isValidPubkey } from "@/lib/jupiter/params";

const SUBSCRIPT = ["₀", "₁", "₂", "₃", "₄", "₅", "₆", "₇", "₈", "₉"];

function subscript(n: number): string {
  return String(n)
    .split("")
    .map((d) => SUBSCRIPT[Number(d)] ?? d)
    .join("");
}

/**
 * A price without the currency sign: 1,234.56 / 107.22 / 1.2345 / 0.4123 /
 * 0.0001234 / 0.0₅322 (four significant digits below 1; runs of 4+ leading
 * zeros are written as a subscript count so tiny meme prices stay readable).
 */
export function formatPlainPrice(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  if (value === 0) return "0";
  if (value < 0) return `-${formatPlainPrice(-value)}`;
  if (value >= 0.99995) {
    const dp = value >= 100 ? 2 : 4;
    return value.toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: dp,
    });
  }
  // toExponential always yields "d.ddde-N" for 0 < value < 1.
  const [mantissa, expPart] = value.toExponential(3).split("e");
  const exp = Number(expPart);
  const digits = mantissa.replace(".", "").replace(/0+$/, "") || "0";
  const zeros = -exp - 1;
  if (zeros < 0) return digits; // unreachable for value < 0.99995
  if (zeros >= 4) return `0.0${subscript(zeros)}${digits}`;
  return `0.${"0".repeat(zeros)}${digits}`;
}

/** "$107.22", "$0.0₅322", or "—" when unknown. */
export function formatPrice(value: number | null | undefined): string {
  const s = formatPlainPrice(value);
  if (s === "—") return s;
  return s.startsWith("-") ? `-$${s.slice(1)}` : `$${s}`;
}

/** "$3.57B", "$61.2K", "$950.00", or "—". */
export function formatCompactUsd(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  const abs = Math.abs(value);
  const sign = value < 0 ? "-" : "";
  const units: [number, string][] = [
    [1e12, "T"],
    [1e9, "B"],
    [1e6, "M"],
    [1e3, "K"],
  ];
  for (const [size, suffix] of units) {
    if (abs >= size) return `${sign}$${(abs / size).toFixed(2)}${suffix}`;
  }
  return `${sign}$${abs.toFixed(2)}`;
}

/** "+1.23%", "-0.40%", or "—". */
export function formatPct(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  const sign = value > 0 ? "+" : value < 0 ? "-" : "";
  return `${sign}${Math.abs(value).toFixed(2)}%`;
}

/** Text colour for a signed change. */
export function changeClass(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value) || value === 0) {
    return "text-muted-foreground";
  }
  return value > 0 ? "text-primary" : "text-destructive";
}

const COMPACT = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 2,
});

/** "1.23M", "8,401" style counts, or "—". */
export function formatCount(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  return value >= 10_000 ? COMPACT.format(value) : Math.round(value).toLocaleString("en-US");
}

/** "So11…1112" style short mint. */
export function shortMint(mint: string, chars = 4): string {
  return mint.length <= chars * 2 + 1 ? mint : `${mint.slice(0, chars)}…${mint.slice(-chars)}`;
}

/**
 * The market Enter opens in the search box. An exact valid mint always wins
 * (a paste must never open something else), then curated matches, then the
 * search results for this very query. `currentSearchMints` is null while the
 * only results available are still those of an earlier query (debounce).
 */
export function enterTarget(
  rawQuery: string,
  curatedMints: readonly string[],
  currentSearchMints: readonly string[] | null
): string | undefined {
  const q = rawQuery.trim();
  if (!q) return undefined;
  if (isValidPubkey(q)) return q;
  return curatedMints[0] ?? currentSearchMints?.[0];
}

/**
 * Whether market-list prices may be out of date: the server served its last
 * good copy (stale), or the latest refetch failed and the previous list is
 * still on screen.
 */
export function marketsDelayed(q: { data?: { stale?: boolean } | undefined; isRefetchError: boolean }): boolean {
  return !!q.data && (q.data.stale === true || q.isRefetchError);
}
