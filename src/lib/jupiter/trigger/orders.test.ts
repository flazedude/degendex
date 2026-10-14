import { describe, expect, it } from "vitest";
import { USDC_MINT } from "@/lib/constants";
import type { TokenInfo } from "@/lib/tokens/types";
import {
  buildCraftBody,
  buildCreateDcaBody,
  buildCreatePriceBody,
  extractUsdPrice,
  isDepositCacheMiss,
  isWithdrawalCacheMiss,
  parseCraftResponse,
  planDca,
  planLimitOrder,
} from "./orders";

const SOL: TokenInfo = { mint: "So11111111111111111111111111111111111111112", symbol: "SOL", decimals: 9 };
const USDC: TokenInfo = { mint: USDC_MINT, symbol: "USDC", decimals: 6 };
const USER = "BQ72nSv9f3PRyRKCBnHLVrerrv37CYTHm5h3s9VSGQDV";
const VAULT = "7nE9GJoYHNmtaQvTQpota3KV2oz4pQ2dA6nvYK8EUJHV";
const NOW = 1_800_000_000_000;
const DAY = 86_400_000;
const ctx = { basePriceUsd: 150, nowMs: NOW };

describe("planLimitOrder", () => {
  it("buy: pays USDC, triggers below on the base mint", () => {
    const r = planLimitOrder(
      { base: SOL, side: "buy", payAmountUi: "25", triggerPriceUsd: 140, expiresInMs: 7 * DAY },
      ctx
    );
    expect(r).toEqual({
      ok: true,
      plan: {
        kind: "limit",
        inputMint: USDC_MINT,
        outputMint: SOL.mint,
        inputDecimals: 6,
        inputSymbol: "USDC",
        amount: "25000000",
        depositUsd: 25,
        triggerMint: SOL.mint,
        triggerCondition: "below",
        triggerPriceUsd: 140,
        expiresAt: NOW + 7 * DAY,
      },
    });
  });

  it("sell: pays base, triggers above", () => {
    const r = planLimitOrder({ base: SOL, side: "sell", payAmountUi: "0.1", triggerPriceUsd: 160, expiresInMs: DAY }, ctx);
    expect(r.ok && r.plan).toMatchObject({
      inputMint: SOL.mint,
      outputMint: USDC_MINT,
      amount: "100000000",
      depositUsd: 15,
      triggerCondition: "above",
    });
  });

  it("refuses stables, tiny orders and the wrong side of the market", () => {
    const base = { side: "buy" as const, payAmountUi: "25", triggerPriceUsd: 140, expiresInMs: DAY };
    expect(planLimitOrder({ ...base, base: USDC }, ctx)).toEqual({ ok: false, error: "Pick a non-stable token" });
    expect(planLimitOrder({ ...base, base: SOL, payAmountUi: "9.99" }, ctx)).toMatchObject({
      ok: false,
      error: expect.stringMatching(/Minimum order is \$10/),
    });
    expect(planLimitOrder({ ...base, base: SOL, triggerPriceUsd: 150 }, ctx)).toMatchObject({
      ok: false,
      error: expect.stringMatching(/buy limit must be below the current SOL price \(\$150(\.00)?\)/),
    });
    expect(planLimitOrder({ ...base, base: SOL, side: "sell", payAmountUi: "1", triggerPriceUsd: 149 }, ctx)).toMatchObject({
      ok: false,
      error: expect.stringMatching(/sell limit must be above/),
    });
    expect(planLimitOrder({ ...base, base: SOL }, { ...ctx, basePriceUsd: null })).toMatchObject({
      ok: false,
      error: expect.stringMatching(/Could not load the current SOL price/),
    });
    expect(planLimitOrder({ ...base, base: SOL, expiresInMs: 31 * DAY }, ctx).ok).toBe(false);
    expect(planLimitOrder({ ...base, base: SOL, expiresInMs: 1000 }, ctx).ok).toBe(false);
    expect(planLimitOrder({ ...base, base: SOL, triggerPriceUsd: Number.NaN }, ctx).ok).toBe(false);
    expect(planLimitOrder({ ...base, base: SOL, payAmountUi: "abc" }, ctx)).toEqual({ ok: false, error: "Enter an amount" });
  });

  it("sell without a price skips the $10 check but still needs a price for the side check", () => {
    const r = planLimitOrder(
      { base: SOL, side: "sell", payAmountUi: "0.001", triggerPriceUsd: 160, expiresInMs: DAY },
      { ...ctx, basePriceUsd: null }
    );
    expect(r).toMatchObject({ ok: false, error: expect.stringMatching(/Could not load/) });
  });
});

describe("planDca", () => {
  const input = { base: SOL, side: "buy" as const, totalPayUi: "100", orderCount: 5, intervalSeconds: 3600 };
  it("accepts and computes per-round USD", () => {
    const r = planDca(input, { ...ctx, activeDcaCount: 3 });
    expect(r.ok && r.plan).toMatchObject({ kind: "dca", amount: "100000000", orderCount: 5, roundUsd: 20 });
  });
  it("enforces $10 per round, the active cap and ranges", () => {
    expect(planDca({ ...input, orderCount: 11 }, { ...ctx, activeDcaCount: 0 })).toMatchObject({
      ok: false,
      error: expect.stringMatching(/at least \$10/),
    });
    expect(planDca(input, { ...ctx, activeDcaCount: 10 })).toMatchObject({
      ok: false,
      error: expect.stringMatching(/at most 10 active DCA/),
    });
    expect(planDca({ ...input, orderCount: 1 }, { ...ctx, activeDcaCount: null }).ok).toBe(false);
    expect(planDca({ ...input, intervalSeconds: 59 }, { ...ctx, activeDcaCount: null }).ok).toBe(false);
    expect(planDca({ ...input, base: USDC }, { ...ctx, activeDcaCount: null }).ok).toBe(false);
  });
  it("sell DCA without a price defers the minimum to Jupiter", () => {
    const r = planDca(
      { base: SOL, side: "sell", totalPayUi: "0.01", orderCount: 2, intervalSeconds: 60 },
      { basePriceUsd: null, nowMs: NOW, activeDcaCount: null }
    );
    expect(r.ok && r.plan.roundUsd).toBeNull();
  });
});

describe("bodies", () => {
  const limit = planLimitOrder({ base: SOL, side: "buy", payAmountUi: "25", triggerPriceUsd: 140, expiresInMs: DAY }, ctx);
  const dca = planDca({ base: SOL, side: "buy", totalPayUi: "100", orderCount: 5, intervalSeconds: 3600 }, { ...ctx, activeDcaCount: 0 });
  if (!limit.ok || !dca.ok) throw new Error("setup");

  it("craft bodies", () => {
    expect(buildCraftBody(limit.plan, USER)).toEqual({
      inputMint: USDC_MINT,
      outputMint: SOL.mint,
      userAddress: USER,
      amount: "25000000",
      orderType: "price",
      orderSubType: "single",
    });
    expect(buildCraftBody(dca.plan, USER)).toEqual({
      inputMint: USDC_MINT,
      outputMint: SOL.mint,
      userAddress: USER,
      amount: "100000000",
      orderType: "dca",
    });
  });

  it("create bodies omit slippage", () => {
    const p = buildCreatePriceBody(limit.plan, USER, "rid", "tx");
    expect(p).toEqual({
      orderType: "single",
      depositRequestId: "rid",
      depositSignedTx: "tx",
      userPubkey: USER,
      inputMint: USDC_MINT,
      inputAmount: "25000000",
      outputMint: SOL.mint,
      triggerMint: SOL.mint,
      triggerCondition: "below",
      triggerPriceUsd: 140,
      expiresAt: NOW + DAY,
    });
    expect("slippageBps" in p).toBe(false);
    expect(buildCreateDcaBody(dca.plan, USER, "rid", "tx")).toEqual({
      orderType: "time_based",
      depositRequestId: "rid",
      depositSignedTx: "tx",
      userPubkey: USER,
      inputMint: USDC_MINT,
      inputAmount: "100000000",
      outputMint: SOL.mint,
      orderCount: 5,
      intervalSeconds: 3600,
    });
  });

  it("parseCraftResponse checks mint, amount, decimals, receiver", () => {
    const good = {
      transaction: "AQ==",
      requestId: "r",
      receiverAddress: VAULT,
      mint: USDC_MINT,
      amount: "25000000",
      tokenDecimals: 6,
      inputTokenAccount: "nope",
    };
    expect(parseCraftResponse(good, limit.plan)).toEqual({
      ok: true,
      craft: { transaction: "AQ==", requestId: "r", receiverAddress: VAULT, mint: USDC_MINT, amount: "25000000", tokenDecimals: 6 },
    });
    expect(parseCraftResponse({ ...good, amount: "1" }, limit.plan).ok).toBe(false);
    expect(parseCraftResponse({ ...good, mint: SOL.mint }, limit.plan).ok).toBe(false);
    expect(parseCraftResponse({ ...good, tokenDecimals: 9 }, limit.plan).ok).toBe(false);
    expect(parseCraftResponse({ ...good, receiverAddress: "x" }, limit.plan).ok).toBe(false);
    expect(parseCraftResponse(null, limit.plan).ok).toBe(false);
  });
});

describe("helpers", () => {
  it("extractUsdPrice handles common shapes", () => {
    const m = SOL.mint;
    expect(extractUsdPrice({ prices: { [m]: 150 } }, m)).toBe(150);
    expect(extractUsdPrice({ [m]: { usdPrice: 151 } }, m)).toBe(151);
    expect(extractUsdPrice({ data: { [m]: { price: "152" } } }, m)).toBe(152);
    expect(extractUsdPrice({ prices: [{ mint: m, priceUsd: 153 }] }, m)).toBe(153);
    expect(extractUsdPrice({ prices: { [m]: null } }, m)).toBeNull();
    expect(extractUsdPrice({ prices: { [m]: -1 } }, m)).toBeNull();
    expect(extractUsdPrice("x", m)).toBeNull();
  });
  it("cache-miss matchers", () => {
    expect(isDepositCacheMiss("Deposit transaction not found in cache. Please craft a new deposit first.")).toBe(true);
    expect(isDepositCacheMiss("Order must be at least 10 USD")).toBe(false);
    expect(isWithdrawalCacheMiss("Withdrawal transaction not found in cache. Please initiate cancel again.")).toBe(true);
  });
});
