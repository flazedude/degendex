// Pure planning for limit / DCA orders: pair resolution (base <-> USDC),
// amounts, the client-side checks that run BEFORE any wallet prompt, and the
// exact request bodies for craft and create. Unit tested; the hooks only wire
// these to the network and the wallet.

import BigNumber from "bignumber.js";
import { formatUsd, safeBigNumber, toBaseUnits } from "@/lib/amounts";
import { USDC_MINT, USDT_MINT } from "@/lib/constants";
import type { TokenInfo } from "@/lib/tokens/types";
import {
  DCA_MAX_INTERVAL_S,
  DCA_MAX_ORDERS,
  DCA_MIN_INTERVAL_S,
  DCA_MIN_ORDERS,
  MAX_ACTIVE_DCA,
  MAX_PRICE_ORDER_EXPIRY_MS,
  MIN_PRICE_ORDER_EXPIRY_MS,
  TRIGGER_MIN_USD,
} from "./config";
import type { TriggerCraftResponse } from "./types";
import { isValidPubkey } from "../params";

export const USDC_DECIMALS = 6;
const STABLE_MINTS = new Set([USDC_MINT, USDT_MINT]);

export type OrderSide = "buy" | "sell";

export interface LimitOrderInput {
  /** The non-stable token being bought or sold against USDC. */
  base: TokenInfo;
  side: OrderSide;
  /** What the user pays, in UI units of the input token (USDC for buy, base for sell). */
  payAmountUi: string;
  /** USD price of `base` that triggers the order. */
  triggerPriceUsd: number;
  expiresInMs: number;
}

export interface DcaInput {
  base: TokenInfo;
  side: OrderSide;
  /** Total to spend over all rounds, in UI units of the input token. */
  totalPayUi: string;
  orderCount: number;
  intervalSeconds: number;
}

export interface PlanContext {
  /** Current USD price of `base`, or null when unavailable. */
  basePriceUsd: number | null;
  /** USD price of USDC (defaults to 1). */
  usdcPriceUsd?: number | null;
  nowMs: number;
}

export interface PairPlan {
  inputMint: string;
  outputMint: string;
  inputDecimals: number;
  inputSymbol: string;
  /** Base units of the input token. */
  amount: string;
  /** Estimated USD value of the deposit, null when no price. */
  depositUsd: number | null;
}

export interface LimitOrderPlan extends PairPlan {
  kind: "limit";
  triggerMint: string;
  triggerCondition: "above" | "below";
  triggerPriceUsd: number;
  expiresAt: number;
}

export interface DcaPlan extends PairPlan {
  kind: "dca";
  orderCount: number;
  intervalSeconds: number;
  /** Estimated USD per round, null when no price. */
  roundUsd: number | null;
}

export type PlanResult<T> = { ok: true; plan: T } | { ok: false; error: string };

const fail = (error: string): { ok: false; error: string } => ({ ok: false, error });

function usd(n: number): string {
  return formatUsd(n) ?? `$${n}`;
}

function resolvePair(
  base: TokenInfo,
  side: OrderSide,
  payUi: string,
  ctx: PlanContext
): PlanResult<PairPlan> {
  if (!base || !isValidPubkey(base.mint)) return fail("Pick a token first");
  if (STABLE_MINTS.has(base.mint)) return fail("Pick a non-stable token");
  if (!Number.isInteger(base.decimals) || base.decimals < 0 || base.decimals > 18) {
    return fail(`Unknown decimals for ${base.symbol}`);
  }
  const buying = side === "buy";
  const inputDecimals = buying ? USDC_DECIMALS : base.decimals;
  const amount = toBaseUnits(payUi, inputDecimals);
  if (!amount) return fail("Enter an amount");
  const usdcPrice = ctx.usdcPriceUsd && ctx.usdcPriceUsd > 0 ? ctx.usdcPriceUsd : 1;
  const unitPrice = buying ? usdcPrice : ctx.basePriceUsd;
  const depositUsd =
    unitPrice && unitPrice > 0
      ? safeBigNumber(payUi).times(unitPrice).toNumber()
      : null;
  return {
    ok: true,
    plan: {
      inputMint: buying ? USDC_MINT : base.mint,
      outputMint: buying ? base.mint : USDC_MINT,
      inputDecimals,
      inputSymbol: buying ? "USDC" : base.symbol,
      amount,
      depositUsd: depositUsd !== null && Number.isFinite(depositUsd) ? depositUsd : null,
    },
  };
}

/** Validates a limit order and resolves everything needed to craft + create it. */
export function planLimitOrder(input: LimitOrderInput, ctx: PlanContext): PlanResult<LimitOrderPlan> {
  const pair = resolvePair(input.base, input.side, input.payAmountUi, ctx);
  if (!pair.ok) return pair;
  const { triggerPriceUsd, expiresInMs } = input;
  if (typeof triggerPriceUsd !== "number" || !Number.isFinite(triggerPriceUsd) || triggerPriceUsd <= 0) {
    return fail("Enter a trigger price");
  }
  if (
    !Number.isFinite(expiresInMs) ||
    expiresInMs < MIN_PRICE_ORDER_EXPIRY_MS ||
    expiresInMs > MAX_PRICE_ORDER_EXPIRY_MS
  ) {
    return fail("Expiry must be between 1 minute and 30 days");
  }
  if (pair.plan.depositUsd !== null && pair.plan.depositUsd < TRIGGER_MIN_USD) {
    return fail(
      `Minimum order is ${usd(TRIGGER_MIN_USD)} (this one is about ${usd(pair.plan.depositUsd)})`
    );
  }
  const symbol = input.base.symbol || "token";
  const price = ctx.basePriceUsd;
  if (price === null || !(price > 0)) {
    return fail(`Could not load the current ${symbol} price to check your trigger. Try again in a moment`);
  }
  // Jupiter does not sanity-check this: a buy above market (or a sell below)
  // would fill immediately at market price.
  if (input.side === "buy" && !(triggerPriceUsd < price)) {
    return fail(
      `A buy limit must be below the current ${symbol} price (${usd(price)}). At or above it the order would fill right away at market`
    );
  }
  if (input.side === "sell" && !(triggerPriceUsd > price)) {
    return fail(
      `A sell limit must be above the current ${symbol} price (${usd(price)}). At or below it the order would fill right away at market`
    );
  }
  return {
    ok: true,
    plan: {
      ...pair.plan,
      kind: "limit",
      triggerMint: input.base.mint,
      triggerCondition: input.side === "buy" ? "below" : "above",
      triggerPriceUsd,
      expiresAt: Math.floor(ctx.nowMs + expiresInMs),
    },
  };
}

/** Validates a time-based DCA. `activeDcaCount` is null when not yet known. */
export function planDca(
  input: DcaInput,
  ctx: PlanContext & { activeDcaCount: number | null }
): PlanResult<DcaPlan> {
  const pair = resolvePair(input.base, input.side, input.totalPayUi, ctx);
  if (!pair.ok) return pair;
  const { orderCount, intervalSeconds } = input;
  if (!Number.isInteger(orderCount) || orderCount < DCA_MIN_ORDERS || orderCount > DCA_MAX_ORDERS) {
    return fail(`Number of orders must be between ${DCA_MIN_ORDERS} and ${DCA_MAX_ORDERS}`);
  }
  if (
    !Number.isInteger(intervalSeconds) ||
    intervalSeconds < DCA_MIN_INTERVAL_S ||
    intervalSeconds > DCA_MAX_INTERVAL_S
  ) {
    return fail("Interval must be between 1 minute and 1 year");
  }
  if (ctx.activeDcaCount !== null && ctx.activeDcaCount >= MAX_ACTIVE_DCA) {
    return fail(
      `Jupiter allows at most ${MAX_ACTIVE_DCA} active DCA orders (including ones waiting for a withdrawal). Cancel or withdraw one first`
    );
  }
  if (new BigNumber(pair.plan.amount).div(orderCount).lt(1)) {
    return fail("Amount is too small to split into that many orders");
  }
  const roundUsd = pair.plan.depositUsd !== null ? pair.plan.depositUsd / orderCount : null;
  if (roundUsd !== null && roundUsd < TRIGGER_MIN_USD) {
    return fail(
      `Each order must be worth at least ${usd(TRIGGER_MIN_USD)}: ${usd(pair.plan.depositUsd!)} over ${orderCount} orders is about ${usd(roundUsd)} each`
    );
  }
  return { ok: true, plan: { ...pair.plan, kind: "dca", orderCount, intervalSeconds, roundUsd } };
}

/** POST deposit/craft body. */
export function buildCraftBody(plan: LimitOrderPlan | DcaPlan, user: string) {
  return plan.kind === "limit"
    ? {
        inputMint: plan.inputMint,
        outputMint: plan.outputMint,
        userAddress: user,
        amount: plan.amount,
        orderType: "price" as const,
        orderSubType: "single" as const,
      }
    : {
        inputMint: plan.inputMint,
        outputMint: plan.outputMint,
        userAddress: user,
        amount: plan.amount,
        orderType: "dca" as const,
      };
}

/** POST orders/price body (slippage omitted = Jupiter auto). */
export function buildCreatePriceBody(
  plan: LimitOrderPlan,
  user: string,
  depositRequestId: string,
  depositSignedTx: string
) {
  return {
    orderType: "single" as const,
    depositRequestId,
    depositSignedTx,
    userPubkey: user,
    inputMint: plan.inputMint,
    inputAmount: plan.amount,
    outputMint: plan.outputMint,
    triggerMint: plan.triggerMint,
    triggerCondition: plan.triggerCondition,
    triggerPriceUsd: plan.triggerPriceUsd,
    expiresAt: plan.expiresAt,
  };
}

/** POST orders/dca body. */
export function buildCreateDcaBody(
  plan: DcaPlan,
  user: string,
  depositRequestId: string,
  depositSignedTx: string
) {
  return {
    orderType: "time_based" as const,
    depositRequestId,
    depositSignedTx,
    userPubkey: user,
    inputMint: plan.inputMint,
    inputAmount: plan.amount,
    outputMint: plan.outputMint,
    orderCount: plan.orderCount,
    intervalSeconds: plan.intervalSeconds,
  };
}

/**
 * Checks a craft response describes exactly what we asked for. Returns the
 * typed response or an error string.
 */
export function parseCraftResponse(
  body: unknown,
  plan: PairPlan
): { ok: true; craft: TriggerCraftResponse } | { ok: false; error: string } {
  if (!body || typeof body !== "object") return fail("Unexpected deposit response from Jupiter");
  const b = body as Record<string, unknown>;
  if (typeof b.transaction !== "string" || !b.transaction) return fail("Jupiter returned no deposit transaction");
  if (typeof b.requestId !== "string" || !b.requestId) return fail("Jupiter returned no deposit request id");
  if (!isValidPubkey(b.receiverAddress)) return fail("Jupiter returned an invalid vault address");
  if (b.mint !== undefined && b.mint !== plan.inputMint) return fail("Deposit is for a different token");
  if (b.amount !== undefined && String(b.amount) !== plan.amount) return fail("Deposit amount does not match your order");
  const decimals = typeof b.tokenDecimals === "number" ? b.tokenDecimals : plan.inputDecimals;
  if (decimals !== plan.inputDecimals) return fail("Deposit token decimals do not match");
  const craft: TriggerCraftResponse = {
    transaction: b.transaction,
    requestId: b.requestId,
    receiverAddress: b.receiverAddress,
    mint: plan.inputMint,
    amount: plan.amount,
    tokenDecimals: decimals,
  };
  if (isValidPubkey(b.inputTokenAccount)) craft.inputTokenAccount = b.inputTokenAccount;
  return { ok: true, craft };
}

/**
 * Pulls a USD price for `mint` out of a loosely-shaped price response
 * ({prices:{mint:n}}, {mint:{usdPrice}}, {data:{mint:{price}}}, ...).
 */
export function extractUsdPrice(body: unknown, mint: string): number | null {
  const pick = (v: unknown): number | null => {
    if (typeof v === "number") return Number.isFinite(v) && v > 0 ? v : null;
    if (typeof v === "string") {
      const n = Number(v);
      return Number.isFinite(n) && n > 0 ? n : null;
    }
    if (v && typeof v === "object") {
      const o = v as Record<string, unknown>;
      return pick(o.usdPrice ?? o.priceUsd ?? o.price ?? null);
    }
    return null;
  };
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  for (const container of [b.prices, b.data, b]) {
    if (container && typeof container === "object" && !Array.isArray(container)) {
      const hit = pick((container as Record<string, unknown>)[mint]);
      if (hit !== null) return hit;
    }
  }
  if (Array.isArray(b.prices)) {
    for (const p of b.prices) {
      if (p && typeof p === "object" && (p as Record<string, unknown>).mint === mint) {
        const hit = pick(p);
        if (hit !== null) return hit;
      }
    }
  }
  return null;
}

/** A price older than this is too old for the "which side of market" check. */
export const MAX_PRICE_AGE_MS = 2 * 60_000;

export type PriceRead =
  | { kind: "fresh"; price: number }
  | { kind: "stale"; price: number }
  | { kind: "missing" };

/**
 * Reads a /api/market/prices response for `mint`, telling a live price from a
 * delayed one: the route flags served-from-stale-cache answers with
 * `stale: true`, and `updatedAt` (epoch ms) says when the price was fetched.
 */
export function readUsdPrice(body: unknown, mint: string, nowMs: number): PriceRead {
  const price = extractUsdPrice(body, mint);
  if (price === null) return { kind: "missing" };
  const b = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const updatedAt = typeof b.updatedAt === "number" && Number.isFinite(b.updatedAt) ? b.updatedAt : null;
  const tooOld = updatedAt !== null && nowMs - updatedAt > MAX_PRICE_AGE_MS;
  return b.stale === true || tooOld ? { kind: "stale", price } : { kind: "fresh", price };
}

/** USD value of `usd` vs the minimum: within this share above it, suggest more. */
export const MIN_ORDER_MARGIN = 0.02;

/** True when `usd` clears the minimum by less than MIN_ORDER_MARGIN. */
export function isNearMinimum(usd: number | null, minUsd: number): boolean {
  return usd !== null && usd >= minUsd && usd < minUsd * (1 + MIN_ORDER_MARGIN);
}

/** Recognises Jupiter's "requestId already used / expired" create error. */
export function isDepositCacheMiss(message: string | undefined): boolean {
  return !!message && /deposit transaction not found in cache/i.test(message);
}

/** Recognises Jupiter's stale cancelRequestId error on confirm-cancel. */
export function isWithdrawalCacheMiss(message: string | undefined): boolean {
  return !!message && /withdrawal transaction not found in cache/i.test(message);
}
