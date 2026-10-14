import { describe, expect, it } from "vitest";
import { USDC_MINT } from "@/lib/constants";
import type { TokenInfo } from "@/lib/tokens/types";
import {
  buildCraftBody,
  buildCreateDcaBody,
  buildCreatePriceBody,
  extractUsdPrice,
  fixedBelow,
  formatUsdBelow,
  MAX_PRICE_AGE_MS,
  isDepositCacheMiss,
  isNearMinimum,
  isWithdrawalCacheMiss,
  minUsdcFor,
  minimumOrderMessage,
  parseCraftResponse,
  planDca,
  planLimitOrder,
  readUsdPrice,
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

describe("readUsdPrice (side-of-market check)", () => {
  const body = (over: Record<string, unknown> = {}) => ({
    prices: { [SOL.mint]: { usdPrice: 150, change24hPct: 1 } },
    updatedAt: NOW - 5_000,
    ...over,
  });

  it("tells a live price from a delayed or old one", () => {
    expect(readUsdPrice(body(), SOL.mint, NOW)).toEqual({ kind: "fresh", price: 150 });
    expect(readUsdPrice(body({ stale: true }), SOL.mint, NOW)).toEqual({ kind: "stale", price: 150 });
    expect(readUsdPrice(body({ updatedAt: NOW - MAX_PRICE_AGE_MS - 1 }), SOL.mint, NOW)).toEqual({
      kind: "stale",
      price: 150,
    });
    expect(MAX_PRICE_AGE_MS).toBe(120_000);
  });

  it("reports a missing price", () => {
    expect(readUsdPrice(body(), USDC_MINT, NOW)).toEqual({ kind: "missing" });
    expect(readUsdPrice(null, SOL.mint, NOW)).toEqual({ kind: "missing" });
    expect(readUsdPrice({ stale: true }, SOL.mint, NOW)).toEqual({ kind: "missing" });
  });
});

describe("USDC valued at its live price ($10 minimum)", () => {
  const input = { base: SOL, side: "buy" as const, payAmountUi: "10", triggerPriceUsd: 140, expiresInMs: DAY };

  it("rejects 10 USDC when USDC trades just under $1", () => {
    expect(planLimitOrder(input, { basePriceUsd: 150, usdcPriceUsd: 0.9997, nowMs: NOW })).toMatchObject({
      ok: false,
      error: expect.stringMatching(/Minimum order is \$10/),
    });
    expect(planLimitOrder(input, { basePriceUsd: 150, usdcPriceUsd: null, nowMs: NOW }).ok).toBe(true);
    expect(planLimitOrder({ ...input, payAmountUi: "10.01" }, { basePriceUsd: 150, usdcPriceUsd: 0.9997, nowMs: NOW }).ok).toBe(
      true
    );
  });

  it("flags amounts within 2% above the minimum", () => {
    expect(isNearMinimum(null, 10)).toBe(false);
    expect(isNearMinimum(9.99, 10)).toBe(false);
    expect(isNearMinimum(10, 10)).toBe(true);
    expect(isNearMinimum(10.19, 10)).toBe(true);
    expect(isNearMinimum(10.2, 10)).toBe(false);
  });
});

describe("telling the user how much USDC clears the $10 minimum", () => {
  const input = { base: SOL, side: "buy" as const, payAmountUi: "10", triggerPriceUsd: 140, expiresInMs: DAY };

  it("names the exact USDC amount when USDC trades just under $1", () => {
    const r = planLimitOrder(input, { basePriceUsd: 150, usdcPriceUsd: 0.9997, nowMs: NOW });
    expect(r.ok).toBe(false);
    const error = (r as { error: string }).error;
    expect(error).toContain("Enter at least 10.01 USDC (Jupiter values USDC at $0.9997)");
    // 10 USDC at $0.9997 is $9.997: never shown as "$10.00".
    expect(error).toContain("about $9.997");
    expect(error).not.toContain("$10.00");
    // And the amount it names really clears the minimum.
    expect(
      planLimitOrder({ ...input, payAmountUi: minUsdcFor(10, 0.9997) }, { basePriceUsd: 150, usdcPriceUsd: 0.9997, nowMs: NOW }).ok
    ).toBe(true);
  });

  it("computes ceil-to-cents of 10 / USDC price", () => {
    expect(minUsdcFor(10, 0.9997)).toBe("10.01");
    expect(minUsdcFor(10, 0.99)).toBe("10.11");
    expect(minUsdcFor(10, 1)).toBe("10.00");
    expect(minUsdcFor(10, 1.0004)).toBe("10.00");
    expect(minUsdcFor(10, null)).toBe("10.00");
    expect(minUsdcFor(10, 0)).toBe("10.00");
    for (const p of [0.9997, 0.9999, 0.98765, 0.999999, 0.95]) {
      expect(Number(minUsdcFor(10, p)) * p).toBeGreaterThanOrEqual(10 - 1e-9);
    }
  });

  it("only adds the USDC note when the live price is under $1, and not on sells", () => {
    expect(minimumOrderMessage("buy", 5, 1)).toBe("Minimum order is $10 (this one is about $5.00). Enter at least 10.00 USDC");
    expect(minimumOrderMessage("buy", 5, null)).not.toMatch(/values USDC/);
    expect(minimumOrderMessage("sell", 9.9999, null)).toBe("Minimum order is $10 (this one is about $9.9999)");
    // The USDC price itself never rounds to $1.0000.
    const msg = minimumOrderMessage("buy", 9.99995, 0.999995);
    expect(msg).toMatch(/values USDC at \$0\.9999\d*\)/);
    expect(msg).toContain("about $9.99995");
  });

  it("formats values just under the minimum with enough precision", () => {
    expect(fixedBelow(9.997, 10)).toBe("9.997");
    expect(fixedBelow(9.5, 10)).toBe("9.50");
    expect(fixedBelow(12.345, 10)).toBe("12.35");
    expect(fixedBelow(9.99999999, 10)).toBe("9.999999");
    expect(formatUsdBelow(9.997)).toBe("$9.997");
    // Two decimals suffice when they already read below the limit.
    expect(formatUsdBelow(9.994)).toBe("$9.99");
    expect(formatUsdBelow(9.9)).toBe("$9.90");
    expect(formatUsdBelow(25)).toBe("$25.00");
    expect(formatUsdBelow(1234.5, 2000)).toBe("$1,234.50");
    expect(formatUsdBelow(null)).toBeNull();
  });

  it("DCA rounds just under $10 never read as $10.00", () => {
    const r = planDca(
      { base: SOL, side: "sell", totalPayUi: "0.13331", orderCount: 2, intervalSeconds: 86_400 },
      { basePriceUsd: 150, nowMs: NOW, activeDcaCount: 0 }
    );
    expect(r.ok).toBe(false);
    expect((r as { error: string }).error).toMatch(/about \$9\.99\d* each/);
    expect((r as { error: string }).error).not.toMatch(/\$10\.00 each/);
  });
});
