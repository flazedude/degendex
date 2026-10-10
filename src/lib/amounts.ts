import BigNumber from "bignumber.js";

// All token math goes through BigNumber / base-unit strings. Never use
// parseFloat(x) * 10 ** decimals: floats lose precision past ~15 digits.

const U64_MAX = new BigNumber("18446744073709551615");
const UI_AMOUNT_RE = /^(?:\d+\.?\d*|\.\d+)$/;

/** BigNumber that never throws (bignumber.js v10 throws on bad input): NaN instead. */
export function safeBigNumber(value: BigNumber.Value | null | undefined): BigNumber {
  if (value === null || value === undefined || value === "") return new BigNumber(NaN);
  try {
    return new BigNumber(value);
  } catch {
    return new BigNumber(NaN);
  }
}

function validDecimals(decimals: number): boolean {
  return Number.isInteger(decimals) && decimals >= 0 && decimals <= 255;
}

/**
 * Converts a user-entered decimal string to base units. Extra decimals beyond
 * the token's precision are rounded DOWN. Returns null for empty, malformed,
 * signed, exponent, zero or > u64 inputs.
 */
export function toBaseUnits(uiAmount: string, decimals: number): string | null {
  if (typeof uiAmount !== "string" || !validDecimals(decimals)) return null;
  const s = uiAmount.trim();
  if (!UI_AMOUNT_RE.test(s)) return null;
  const raw = new BigNumber(s)
    .shiftedBy(decimals)
    .integerValue(BigNumber.ROUND_DOWN);
  if (!raw.isFinite() || raw.lte(0) || raw.gt(U64_MAX)) return null;
  return raw.toFixed(0);
}

/** Converts base units to an exact decimal string (no trailing zeros). */
export function fromBaseUnits(raw: string | bigint, decimals: number): string {
  if (!validDecimals(decimals)) return "0";
  const bn = safeBigNumber(typeof raw === "bigint" ? raw.toString() : raw);
  if (!bn.isFinite()) return "0";
  return bn.shiftedBy(-decimals).toFixed();
}

export interface FormatTokenAmountOptions {
  /** Significant digits kept for values below 1 (default 4). */
  significant?: number;
  /** Max decimals for values >= 1 (default 4, 2 above 1,000). */
  maxDecimals?: number;
  /** Rounding mode (default ROUND_DOWN: never overstate a balance). */
  roundingMode?: BigNumber.RoundingMode;
}

/** Human display: 1,234.56 / 12.3456 / 0.00001234. Input must be a UI amount. */
export function formatTokenAmount(
  ui: string | number,
  opts: FormatTokenAmountOptions = {}
): string {
  const bn = safeBigNumber(ui);
  if (!bn.isFinite()) return "—";
  if (bn.isZero()) return "0";
  const rm = opts.roundingMode ?? BigNumber.ROUND_DOWN;
  const abs = bn.abs();
  if (abs.gte(1)) {
    const dp = opts.maxDecimals ?? (abs.gte(1000) ? 2 : 4);
    return bn.decimalPlaces(dp, rm).toFormat();
  }
  if (abs.lt("1e-12")) return bn.isNegative() ? "-<0.000000000001" : "<0.000000000001";
  const sig = opts.significant ?? 4;
  return bn.precision(sig, rm).toFixed();
}

/** USD display with cents, or a compact form for tiny values. */
export function formatUsd(value: number | null | undefined): string | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  if (value > 0 && value < 0.01) return "<$0.01";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(value);
}

/**
 * Cuts a decimal string to at most `decimals` fraction digits (never rounds
 * up). Drops a trailing "." and returns "" for empty or zero results.
 */
export function truncateToDecimals(amount: string, decimals: number): string {
  if (typeof amount !== "string" || !validDecimals(decimals)) return "";
  const s = amount.trim();
  if (!UI_AMOUNT_RE.test(s)) return "";
  const [int, frac = ""] = s.split(".");
  const cut = frac.slice(0, decimals);
  const out = cut ? `${int || "0"}.${cut}` : int || "0";
  return /^0*\.?0*$/.test(out) ? "" : out;
}

const MAX_AMOUNT_INPUT_LENGTH = 40;

/**
 * Normalises what the user typed or pasted into the amount field. Returns the
 * new value, or null to reject the edit (the controlled input keeps its value).
 *
 * Commas are thousands separators when the text also has a "." or more than
 * one comma ("1,234.56", "1,000,000"); a single lone comma is a decimal comma
 * ("1,5" -> "1.5") for comma-decimal keyboards.
 */
export function sanitizeAmount(value: string, decimals: number): string | null {
  let t = value.replace(/\s/g, "");
  const commas = (t.match(/,/g) ?? []).length;
  if (commas > 0) {
    const dot = t.indexOf(".");
    // "1.234,56" (European grouping) is ambiguous here: reject, don't guess.
    if (dot >= 0 && t.lastIndexOf(",") > dot) return null;
    t = dot >= 0 || commas > 1 ? t.replace(/,/g, "") : t.replace(",", ".");
  }
  if (t === "") return "";
  if (!/^\d*\.?\d*$/.test(t) || t.length > MAX_AMOUNT_INPUT_LENGTH) return null;
  if (t.startsWith(".")) t = `0${t}`;
  const frac = t.split(".")[1];
  if (frac !== undefined && (decimals === 0 || frac.length > decimals)) return null;
  return t.replace(/^0+(?=\d)/, "");
}
