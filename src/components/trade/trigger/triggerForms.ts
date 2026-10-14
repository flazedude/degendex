// Form maths and validation for the limit and DCA forms. Pure (unit tested).
// The same planners the actions hook runs (planLimitOrder / planDca) decide
// what is placeable, so the button never promises what the hook refuses.

import BigNumber from "bignumber.js";
import { formatTokenAmount, fromBaseUnits, safeBigNumber, toBaseUnits } from "@/lib/amounts";
import { POPULAR_TOKENS, USDC_MINT } from "@/lib/constants";
import {
  DCA_MAX_INTERVAL_S,
  DCA_MAX_ORDERS,
  DCA_MIN_INTERVAL_S,
  DCA_MIN_ORDERS,
  MAX_ACTIVE_DCA,
  TRIGGER_MIN_USD,
} from "@/lib/jupiter/trigger/config";
import { planDca, planLimitOrder, type OrderSide } from "@/lib/jupiter/trigger/orders";
import type { TokenInfo } from "@/lib/tokens/types";
import { distancePct, isStableToken } from "./triggerFormat";

export const USDC_TOKEN: TokenInfo = POPULAR_TOKENS.find((t) => t.mint === USDC_MINT)!;

const DAY_MS = 86_400_000;

export const EXPIRY_OPTIONS = [
  { id: "1d", label: "1 day", ms: DAY_MS },
  { id: "7d", label: "7 days", ms: 7 * DAY_MS },
  { id: "30d", label: "30 days", ms: 30 * DAY_MS },
] as const;
export type ExpiryChoice = (typeof EXPIRY_OPTIONS)[number]["id"];
export const DEFAULT_EXPIRY: ExpiryChoice = "7d";

export function expiryMs(choice: ExpiryChoice): number {
  return (EXPIRY_OPTIONS.find((o) => o.id === choice) ?? EXPIRY_OPTIONS[1]).ms;
}

/** Quick trigger offsets in percent: below market for buys, above for sells. */
export function triggerOffsets(side: OrderSide): number[] {
  return side === "buy" ? [-1, -5, -10] : [1, 5, 10];
}

/** What the user pays: USDC for a buy, the base token for a sell. */
export function payToken(base: TokenInfo, side: OrderSide): TokenInfo {
  return side === "buy" ? USDC_TOKEN : base;
}

/** What the user receives. */
export function receiveToken(base: TokenInfo, side: OrderSide): TokenInfo {
  return side === "buy" ? base : USDC_TOKEN;
}

/** Positive finite number from a typed price, or null. */
export function parsePrice(text: string): number | null {
  const t = text.trim();
  if (!/^(?:\d+\.?\d*|\.\d+)$/.test(t)) return null;
  const n = Number(t);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Positive integer from a typed count, or null. */
export function parseCount(text: string): number | null {
  const t = text.trim();
  if (!/^\d{1,7}$/.test(t)) return null;
  const n = Number(t);
  return n > 0 ? n : null;
}

/**
 * Estimated output at the trigger price (UI units, display string), or null.
 * Buy: pay USDC / trigger = base. Sell: pay base * trigger = USDC. Approximate:
 * fees, slippage and the USDC peg are ignored.
 */
export function estimateReceive(side: OrderSide, payUi: string, triggerPriceUsd: number | null): string | null {
  if (triggerPriceUsd === null || !(triggerPriceUsd > 0)) return null;
  const pay = safeBigNumber(payUi);
  if (!pay.isFinite() || pay.lte(0)) return null;
  const out = side === "buy" ? pay.div(triggerPriceUsd) : pay.times(triggerPriceUsd);
  if (!out.isFinite() || out.lte(0)) return null;
  return formatTokenAmount(out.toFixed(), { significant: 6, maxDecimals: side === "buy" ? 6 : 2 });
}

/** USD value of what is paid, or null when no price (USDC counts as $1). */
export function payUsd(side: OrderSide, payUi: string, marketPriceUsd: number | null): number | null {
  const pay = safeBigNumber(payUi);
  if (!pay.isFinite() || pay.lte(0)) return null;
  const unit = side === "buy" ? 1 : marketPriceUsd;
  if (unit === null || !(unit > 0)) return null;
  const v = pay.times(unit).toNumber();
  return Number.isFinite(v) ? v : null;
}

/** True when both are known and the amount is more than the balance. */
export function exceeds(rawAmount: string | null, balanceRaw: string | undefined): boolean {
  return !!rawAmount && balanceRaw !== undefined && safeBigNumber(rawAmount).gt(safeBigNumber(balanceRaw));
}

// ---------------------------------------------------------------------------
// Limit order

export interface LimitFormInput {
  base: TokenInfo;
  side: OrderSide;
  payAmount: string;
  triggerPrice: string;
  expiry: ExpiryChoice;
  /** Live USD price of base, null when unknown. */
  marketPriceUsd: number | null;
  /** True when the live price is delayed (stale cache or failed refresh). */
  marketStale?: boolean;
  /** Pay-token balance in base units, undefined while unknown. */
  balanceRaw: string | undefined;
}

export interface LimitFormView {
  payRaw: string | null;
  triggerPriceUsd: number | null;
  distancePct: number | null;
  /** ≈ output at the trigger price (display string). */
  estReceive: string | null;
  depositUsd: number | null;
  belowMinimum: boolean;
  insufficient: boolean;
  /** Why the order cannot be placed; null when it can. */
  blocker: string | null;
  /** Non-blocking notes. */
  warnings: string[];
}

/** Fill this close to market or closer is flagged as "fills almost right away". */
const NEAR_MARKET_PCT = 0.5;
/** Further than this from market is flagged as "may never fill". */
const FAR_MARKET_PCT = 50;

export function limitFormView(input: LimitFormInput): LimitFormView {
  const { base, side, payAmount, marketPriceUsd } = input;
  const pay = payToken(base, side);
  const payRaw = toBaseUnits(payAmount, pay.decimals);
  const triggerPriceUsd = parsePrice(input.triggerPrice);
  const dist = distancePct(triggerPriceUsd, marketPriceUsd);
  const depositUsd = payUsd(side, payAmount, marketPriceUsd);
  const insufficient = exceeds(payRaw, input.balanceRaw);
  const warnings: string[] = [];

  let blocker: string | null = null;
  if (isStableToken(base)) blocker = "Pick a non-stable token";
  else if (!payRaw) blocker = "Enter an amount";
  else if (insufficient) blocker = `Insufficient ${pay.symbol} balance`;
  else if (triggerPriceUsd === null) blocker = "Enter a trigger price";
  else {
    const planned = planLimitOrder(
      {
        base,
        side,
        payAmountUi: payAmount,
        triggerPriceUsd,
        expiresInMs: expiryMs(input.expiry),
      },
      // nowMs only feeds expiresAt, which the form does not use.
      { basePriceUsd: marketPriceUsd, nowMs: 0 }
    );
    if (!planned.ok) blocker = planned.error;
  }

  if (dist !== null && blocker === null) {
    if (Math.abs(dist) <= NEAR_MARKET_PCT) {
      warnings.push("Your trigger is very close to the market price, so the order may fill almost right away.");
    } else if (Math.abs(dist) >= FAR_MARKET_PCT) {
      warnings.push(
        `Your trigger is ${Math.abs(dist).toFixed(0)}% from the market price. The order may never fill before it expires.`
      );
    }
  }
  if (input.marketStale && marketPriceUsd !== null) {
    warnings.push("The market price shown is delayed. Check your trigger against a live price.");
  }

  return {
    payRaw,
    triggerPriceUsd,
    distancePct: dist,
    estReceive: payRaw ? estimateReceive(side, payAmount, triggerPriceUsd) : null,
    depositUsd,
    belowMinimum: depositUsd !== null && depositUsd < TRIGGER_MIN_USD,
    insufficient,
    blocker,
    warnings,
  };
}

// ---------------------------------------------------------------------------
// DCA

export const INTERVAL_OPTIONS = [
  { id: "minute", label: "1 min", seconds: 60 },
  { id: "hour", label: "1 hour", seconds: 3_600 },
  { id: "day", label: "1 day", seconds: 86_400 },
  { id: "week", label: "1 week", seconds: 604_800 },
  { id: "custom", label: "Custom", seconds: null },
] as const;
export type IntervalChoice = (typeof INTERVAL_OPTIONS)[number]["id"];
export const DEFAULT_INTERVAL: IntervalChoice = "day";

/** Interval in whole seconds, or null when the custom value is unusable. */
export function intervalSeconds(choice: IntervalChoice, customHours: string): number | null {
  const preset = INTERVAL_OPTIONS.find((o) => o.id === choice);
  if (preset && preset.seconds !== null) return preset.seconds;
  const h = parsePrice(customHours);
  if (h === null) return null;
  const s = Math.round(h * 3_600);
  return s >= DCA_MIN_INTERVAL_S && s <= DCA_MAX_INTERVAL_S ? s : null;
}

export interface DcaFormInput {
  base: TokenInfo;
  side: OrderSide;
  totalAmount: string;
  orderCount: string;
  interval: IntervalChoice;
  customHours: string;
  marketPriceUsd: number | null;
  balanceRaw: string | undefined;
  /** Active DCA orders (withdrawing included), null while unknown. */
  activeDcaCount: number | null;
}

export interface DcaFormView {
  totalRaw: string | null;
  orderCount: number | null;
  intervalSeconds: number | null;
  /** Pay-token amount per round (display string). */
  perRound: string | null;
  perRoundUsd: number | null;
  totalUsd: number | null;
  /** Seconds from the first round to the last ((n - 1) * interval). */
  durationSeconds: number | null;
  insufficient: boolean;
  belowMinimum: boolean;
  atCap: boolean;
  blocker: string | null;
  warnings: string[];
}

export function dcaFormView(input: DcaFormInput): DcaFormView {
  const { base, side, totalAmount } = input;
  const pay = payToken(base, side);
  const totalRaw = toBaseUnits(totalAmount, pay.decimals);
  const count = parseCount(input.orderCount);
  const secs = intervalSeconds(input.interval, input.customHours);
  const totalUsd = payUsd(side, totalAmount, input.marketPriceUsd);
  const insufficient = exceeds(totalRaw, input.balanceRaw);
  const atCap = input.activeDcaCount !== null && input.activeDcaCount >= MAX_ACTIVE_DCA;
  const validCount = count !== null && count >= DCA_MIN_ORDERS && count <= DCA_MAX_ORDERS;

  let perRound: string | null = null;
  let perRoundUsd: number | null = null;
  if (totalRaw && validCount) {
    const raw = new BigNumber(totalRaw).div(count!).integerValue(BigNumber.ROUND_DOWN);
    if (raw.gt(0)) {
      perRound = formatTokenAmount(fromBaseUnits(raw.toFixed(0), pay.decimals), {
        significant: 6,
        maxDecimals: 6,
      });
    }
    perRoundUsd = totalUsd !== null ? totalUsd / count! : null;
  }

  let blocker: string | null = null;
  if (isStableToken(base)) blocker = "Pick a non-stable token";
  else if (atCap) {
    blocker = `You have ${MAX_ACTIVE_DCA} active DCA orders, Jupiter's limit. Cancel or withdraw one first`;
  } else if (!totalRaw) blocker = "Enter an amount";
  else if (insufficient) blocker = `Insufficient ${pay.symbol} balance`;
  else if (!validCount) blocker = `Number of orders must be between ${DCA_MIN_ORDERS} and ${DCA_MAX_ORDERS}`;
  else if (secs === null) blocker = "Custom interval must be between 1 minute and 8760 hours (1 year)";
  else {
    const planned = planDca(
      { base, side, totalPayUi: totalAmount, orderCount: count!, intervalSeconds: secs },
      { basePriceUsd: input.marketPriceUsd, nowMs: 0, activeDcaCount: input.activeDcaCount }
    );
    if (!planned.ok) blocker = planned.error;
  }

  const warnings: string[] = [];
  if (side === "sell" && input.marketPriceUsd === null && totalRaw) {
    warnings.push(
      `Couldn't load the ${base.symbol} price, so the $${TRIGGER_MIN_USD}-per-round minimum is checked by Jupiter when you place the order.`
    );
  }

  return {
    totalRaw,
    orderCount: count,
    intervalSeconds: secs,
    perRound,
    perRoundUsd,
    totalUsd,
    durationSeconds: validCount && secs !== null ? (count! - 1) * secs : null,
    insufficient,
    belowMinimum: perRoundUsd !== null && perRoundUsd < TRIGGER_MIN_USD,
    atCap,
    blocker,
    warnings,
  };
}

// ---------------------------------------------------------------------------
// Live price

export const TOKEN_2022_PROGRAM = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";

/**
 * USD price of `base` for the forms: the market header's price (polled every
 * 15 s), else the token's own usdPrice. `stale` when the header says so, its
 * latest refresh failed, or only the fallback is available.
 */
export function liveBasePrice(
  base: Pick<TokenInfo, "usdPrice">,
  detail: { data?: { priceUsd: number | null; stale?: boolean } | undefined; isError: boolean }
): { priceUsd: number | null; stale: boolean } {
  const live = detail.data?.priceUsd;
  if (typeof live === "number" && Number.isFinite(live) && live > 0) {
    return { priceUsd: live, stale: detail.data?.stale === true || detail.isError };
  }
  const fb = base.usdPrice;
  if (typeof fb === "number" && Number.isFinite(fb) && fb > 0) return { priceUsd: fb, stale: true };
  return { priceUsd: null, stale: false };
}
