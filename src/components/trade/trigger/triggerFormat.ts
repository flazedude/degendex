// Display helpers for limit / DCA orders. Pure (unit tested). Token amounts
// are base-unit strings and go through BigNumber; prices and percentages are
// display-only floats.

import BigNumber from "bignumber.js";
import { formatTokenAmount, fromBaseUnits, safeBigNumber } from "@/lib/amounts";
import { POPULAR_TOKENS, USDC_MINT, USDT_MINT } from "@/lib/constants";
import type { TriggerOrderRow, TriggerOrderStatus } from "@/lib/jupiter/trigger/types";
import type { TokenInfo } from "@/lib/tokens/types";
import { shortenAddress } from "@/lib/utils";

const STABLE_MINTS = new Set([USDC_MINT, USDT_MINT]);

/**
 * True for stablecoins that cannot be the base of a limit / DCA order here
 * (USDC, USDT from the curated list, or anything Jupiter tags "stablecoin").
 */
export function isStableToken(token: Pick<TokenInfo, "mint" | "tags"> | null | undefined): boolean {
  if (!token) return false;
  if (STABLE_MINTS.has(token.mint)) return true;
  return (token.tags ?? []).some((t) => t.toLowerCase() === "stablecoin");
}

const CURATED = new Map(POPULAR_TOKENS.map((t) => [t.mint, t]));

/** Metadata for a mint: Jupiter metadata first, then the curated list. */
export function tokenFor(
  mint: string,
  metadata: Record<string, TokenInfo> | undefined
): TokenInfo | undefined {
  return metadata?.[mint] ?? CURATED.get(mint);
}

/** Ticker for a mint, or a shortened mint when unknown. */
export function symbolFor(mint: string, metadata: Record<string, TokenInfo> | undefined): string {
  return tokenFor(mint, metadata)?.symbol || shortenAddress(mint);
}

/**
 * Base-unit amount -> "1,234.56 SYM". "—" when decimals are unknown (we never
 * guess decimals for display).
 */
export function formatBaseAmount(
  raw: string | null | undefined,
  token: TokenInfo | undefined,
  opts: { withSymbol?: boolean } = {}
): string {
  if (raw === null || raw === undefined || !token) return "—";
  const bn = safeBigNumber(raw);
  if (!bn.isFinite() || bn.isNegative()) return "—";
  const ui = formatTokenAmount(fromBaseUnits(bn.toFixed(0), token.decimals), {
    significant: 4,
    maxDecimals: 4,
  });
  return opts.withSymbol === false ? ui : `${ui} ${token.symbol}`;
}

export type RowSide = "buy" | "sell" | null;

/** Buy when paying a stablecoin, sell when receiving one, else unknown. */
export function rowSide(row: Pick<TriggerOrderRow, "inputMint" | "outputMint">): RowSide {
  if (STABLE_MINTS.has(row.inputMint) && !STABLE_MINTS.has(row.outputMint)) return "buy";
  if (STABLE_MINTS.has(row.outputMint) && !STABLE_MINTS.has(row.inputMint)) return "sell";
  return null;
}

/** "Limit buy" / "Limit sell" / "DCA buy" / "DCA" ... */
export function orderTypeLabel(row: Pick<TriggerOrderRow, "family" | "inputMint" | "outputMint">): string {
  const kind = row.family === "price" ? "Limit" : "DCA";
  const side = rowSide(row);
  return side ? `${kind} ${side}` : kind;
}

/** The non-stable leg of the order (what the trigger / pair is about). */
export function baseMintOf(row: Pick<TriggerOrderRow, "inputMint" | "outputMint" | "triggerMint">): string {
  if (row.triggerMint) return row.triggerMint;
  return rowSide(row) === "buy" ? row.outputMint : row.inputMint;
}

export type StatusTone = "neutral" | "active" | "good" | "warn" | "bad" | "muted";

const STATUS: Record<TriggerOrderStatus, { label: string; tone: StatusTone }> = {
  open: { label: "Open", tone: "active" },
  filling: { label: "Filling", tone: "active" },
  filled: { label: "Filled", tone: "good" },
  cancelled: { label: "Cancelled", tone: "muted" },
  expired: { label: "Expired", tone: "warn" },
  needs_withdraw: { label: "Needs withdraw", tone: "warn" },
  withdrawing: { label: "Withdrawing", tone: "warn" },
  failed: { label: "Failed", tone: "bad" },
  unknown: { label: "Unknown", tone: "neutral" },
};

export const FUNDS_MAY_BE_HELD_NOTE =
  "The order executed, but a later step at Jupiter failed. Funds may still be held in your Jupiter vault: check jup.ag or contact Jupiter support.";

/** Status chip text + tone. Unknown statuses never throw. */
export function statusChip(
  row: Pick<TriggerOrderRow, "status" | "state" | "canWithdraw"> & Partial<Pick<TriggerOrderRow, "fundsMayBeHeld">>
): {
  label: string;
  tone: StatusTone;
  title: string;
} {
  const s = STATUS[row.status] ?? STATUS.unknown;
  let label = s.label;
  let title = `Jupiter state: ${row.state || "unknown"}`;
  // A DCA "withdrawing" order is stuck mid-cancel until the user withdraws.
  if (row.status === "withdrawing" && row.canWithdraw) label = "Needs withdraw";
  if (row.status === "expired" && row.canWithdraw) label = "Expired · funds held";
  if (row.fundsMayBeHeld) {
    label = "Failed · funds may be held";
    title = `${FUNDS_MAY_BE_HELD_NOTE} (${title})`;
  }
  if (row.status === "unknown") title = `Status not recognised. ${title}`;
  return { label, tone: s.tone, title };
}

/**
 * History "Paid" figure: what fills actually spent, plus what went (or is
 * waiting to go) back. `paid` is null when Jupiter does not say how much was
 * spent; then only the deposit is known. `notDeposited` marks a deposit that
 * never landed (nothing was spent or refunded).
 *
 * The remainder label follows the row's state: "in vault" while funds wait
 * for a Withdraw (expired orders never auto-refund, including ready_expire
 * before Withdraw is offered), "refunded" only once the order is cancelled /
 * filled or expired with nothing left.
 */
export function paidSummary(
  row: Pick<
    TriggerOrderRow,
    "inputAmountInitial" | "inputAmountUsed" | "inputAmountRemaining" | "canWithdraw" | "fundsMayBeHeld" | "status" | "state"
  >
): { paid: string | null; deposited: string; remainder: string | null; remainderLabel: string; notDeposited?: true } {
  const deposited = safeBigNumber(row.inputAmountInitial);
  if (row.state === "deposit_failed") {
    return { paid: null, deposited: row.inputAmountInitial, remainder: null, remainderLabel: "not deposited", notDeposited: true };
  }
  const remainderLabel = remainderLabelFor(row);
  if (row.inputAmountUsed === undefined || !deposited.isFinite()) {
    return { paid: null, deposited: row.inputAmountInitial, remainder: null, remainderLabel };
  }
  const used = BigNumber.min(safeBigNumber(row.inputAmountUsed), deposited);
  const rest = deposited.minus(used);
  return {
    paid: used.toFixed(0),
    deposited: row.inputAmountInitial,
    remainder: rest.gt(0) ? rest.toFixed(0) : null,
    remainderLabel,
  };
}

function remainderLabelFor(
  row: Pick<TriggerOrderRow, "inputAmountRemaining" | "canWithdraw" | "fundsMayBeHeld" | "status">
): string {
  if (row.canWithdraw) return "in vault";
  if (row.fundsMayBeHeld) return "may be held";
  switch (row.status) {
    case "cancelled":
    case "filled":
      return "refunded";
    case "expired":
      // Expired orders keep their funds until withdrawn.
      return safeBigNumber(row.inputAmountRemaining).gt(0) ? "in vault" : "refunded";
    case "needs_withdraw":
    case "withdrawing":
      return "in vault";
    case "open":
    case "filling":
      return "unfilled";
    default:
      // failed / unknown: where the rest went is not reported.
      return "unspent";
  }
}

/** Remainder labels that mean funds still wait somewhere (highlighted). */
export function remainderNeedsAttention(label: string): boolean {
  return label === "in vault" || label === "may be held";
}

/**
 * Jupiter reports the swap ran but paying the output out failed
 * (withdraw_failed): the output figure is owed, not received.
 */
export function outputNotPaidOut(row: Pick<TriggerOrderRow, "state" | "fundsMayBeHeld">): boolean {
  return !!row.fundsMayBeHeld && row.state === "withdraw_failed";
}

/** "Cancel" for live orders; plain "Cancel & withdraw" for unrecognised states. */
export function cancelLabel(row: Pick<TriggerOrderRow, "status">): string {
  return row.status === "unknown" ? "Cancel & withdraw" : "Cancel";
}

/** "$10 minimum", with a nudge when the amount only just clears it. */
export function minimumText(minUsd: number, nearMinimum: boolean): string {
  return nearMinimum ? `$${minUsd} minimum (we suggest a little more)` : `$${minUsd} minimum`;
}

export const TONE_CLASS: Record<StatusTone, string> = {
  neutral: "border-border/60 text-muted-foreground",
  active: "border-primary/40 text-primary",
  good: "border-primary/40 bg-primary/10 text-primary",
  warn: "border-yellow-500/50 bg-yellow-500/10 text-yellow-500",
  bad: "border-destructive/50 bg-destructive/10 text-destructive",
  muted: "border-border/50 text-muted-foreground",
};

/** Filled share as "42%" (fillPercent is 0..1), or from rounds for DCA. */
export function fillPercentText(
  row: Pick<TriggerOrderRow, "fillPercent" | "orderCount" | "roundsFilled" | "status">
): string {
  let f = row.fillPercent;
  if ((f === undefined || !Number.isFinite(f)) && row.orderCount && row.roundsFilled !== undefined) {
    f = row.roundsFilled / row.orderCount;
  }
  if (f === undefined || !Number.isFinite(f)) return row.status === "filled" ? "100%" : "—";
  const pct = Math.min(100, Math.max(0, f * 100));
  if (pct > 0 && pct < 1) return "<1%";
  return `${Math.floor(pct)}%`;
}

/** "3 / 10" rounds, or "—". */
export function roundsText(row: Pick<TriggerOrderRow, "orderCount" | "roundsFilled">): string {
  if (!row.orderCount) return "—";
  return `${row.roundsFilled ?? 0} / ${row.orderCount}`;
}

/**
 * Compact duration: "45s", "12m", "3h 20m", "6d 4h", "2w 3d" (seconds in).
 * Two units at most; zero sub-units are dropped.
 */
export function formatDuration(totalSeconds: number): string {
  if (!Number.isFinite(totalSeconds) || totalSeconds < 0) return "—";
  const s = Math.floor(totalSeconds);
  if (s < 60) return `${s}s`;
  const units: [string, number][] = [
    ["y", 365 * 86_400],
    ["w", 7 * 86_400],
    ["d", 86_400],
    ["h", 3_600],
    ["m", 60],
  ];
  let rest = s;
  const parts: string[] = [];
  for (const [label, size] of units) {
    if (parts.length === 2) break;
    const n = Math.floor(rest / size);
    if (n > 0) {
      parts.push(`${n}${label}`);
      rest -= n * size;
    } else if (parts.length === 1) {
      // Keep units adjacent: "1w 0d 5h" reads as "1w", not "1w 5h".
      break;
    }
  }
  return parts.join(" ") || "0m";
}

/** Human interval: "every minute" / "every 2 hours" / "every day". */
export function formatInterval(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return "—";
  const named: [number, string, string][] = [
    [7 * 86_400, "week", "weeks"],
    [86_400, "day", "days"],
    [3_600, "hour", "hours"],
    [60, "minute", "minutes"],
  ];
  for (const [size, one, many] of named) {
    if (seconds >= size && seconds % size === 0) {
      const n = seconds / size;
      return n === 1 ? `every ${one}` : `every ${n} ${many}`;
    }
  }
  return `every ${formatDuration(seconds)}`;
}

/**
 * Time left until `targetMs`: "6d 23h", "12m", "45s", or `pastLabel` once
 * reached. "—" when unknown or the clock is not running yet (SSR: now = 0).
 */
export function formatCountdown(targetMs: number | undefined, nowMs: number, pastLabel = "now"): string {
  if (!targetMs || !Number.isFinite(targetMs) || nowMs <= 0) return "—";
  const left = (targetMs - nowMs) / 1000;
  if (left <= 0) return pastLabel;
  return formatDuration(left);
}

/** Local date-time for history rows: "Oct 14, 14:05". "—" when unknown. */
export function formatDateTime(ms: number): string {
  if (!ms || !Number.isFinite(ms)) return "—";
  const d = new Date(ms);
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

/** (trigger - market) / market in percent, null when either is unusable. */
export function distancePct(triggerPriceUsd: number | null, marketPriceUsd: number | null): number | null {
  if (
    triggerPriceUsd === null ||
    marketPriceUsd === null ||
    !Number.isFinite(triggerPriceUsd) ||
    !Number.isFinite(marketPriceUsd) ||
    triggerPriceUsd <= 0 ||
    marketPriceUsd <= 0
  ) {
    return null;
  }
  return ((triggerPriceUsd - marketPriceUsd) / marketPriceUsd) * 100;
}

/**
 * A price as an input string: 6 significant digits, never exponent notation,
 * no trailing zeros ("" for unusable values).
 */
export function priceToInput(price: number | null | undefined): string {
  if (typeof price !== "number" || !Number.isFinite(price) || price <= 0) return "";
  return new BigNumber(price).precision(6, BigNumber.ROUND_HALF_UP).toFixed();
}

/** `price` moved by `pct` percent, formatted for the input. */
export function offsetPrice(price: number | null | undefined, pct: number): string {
  if (typeof price !== "number" || !Number.isFinite(price) || price <= 0) return "";
  return priceToInput(price * (1 + pct / 100));
}

/** Solscan link for a transaction signature, null when it does not look like one. */
export function solscanTx(signature: string | undefined): string | null {
  if (!signature || !/^[1-9A-HJ-NP-Za-km-z]{32,100}$/.test(signature)) return null;
  return `https://solscan.io/tx/${signature}`;
}

/** Short label for an order event: "Deposit", "Fill", "Withdrawal"... */
export function eventLabel(type: string): string {
  const t = (type || "event").replace(/[_-]+/g, " ").trim();
  return t.charAt(0).toUpperCase() + t.slice(1);
}

/** "1–20 of 57" for a page. */
export function pageRangeText(offset: number, count: number, total: number): string {
  if (count <= 0) return total > 0 ? `0 of ${total}` : "0";
  const from = offset + 1;
  const to = offset + count;
  return `${from}–${to} of ${Math.max(total, to)}`;
}

/** Stable identity of a row across families (ids are only unique per family). */
export function rowKey(row: Pick<TriggerOrderRow, "family" | "id">): string {
  return `${row.family}:${row.id}`;
}

/**
 * Open-orders list: active rows plus withdraw-needing rows that only appear in
 * past orders (expired price orders), deduped, withdraw-needing first.
 */
export function mergeOpenRows(
  activeRows: readonly TriggerOrderRow[],
  needsWithdraw: readonly TriggerOrderRow[]
): TriggerOrderRow[] {
  const seen = new Set<string>();
  const out: TriggerOrderRow[] = [];
  // Active rows first: on a duplicate their (fresher, 30 s) copy wins.
  for (const r of [...activeRows, ...needsWithdraw]) {
    const k = rowKey(r);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(r);
  }
  const rank = (r: TriggerOrderRow) => (r.canWithdraw ? 0 : 1);
  return out
    .map((r, i) => ({ r, i }))
    .sort((a, b) => rank(a.r) - rank(b.r) || a.i - b.i)
    .map(({ r }) => r);
}
