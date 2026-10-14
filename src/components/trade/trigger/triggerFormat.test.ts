import { describe, expect, it } from "vitest";
import { POPULAR_TOKENS, SOL_MINT, USDC_MINT } from "@/lib/constants";
import type { TriggerOrderRow } from "@/lib/jupiter/trigger/types";
import {
  FUNDS_MAY_BE_HELD_NOTE,
  baseMintOf,
  cancelLabel,
  distancePct,
  eventLabel,
  fillPercentText,
  formatBaseAmount,
  formatCountdown,
  formatDuration,
  formatInterval,
  isStableToken,
  mergeOpenRows,
  minimumText,
  offsetPrice,
  outputNotPaidOut,
  orderTypeLabel,
  pageRangeText,
  paidSummary,
  priceToInput,
  remainderNeedsAttention,
  roundsText,
  rowSide,
  solscanTx,
  statusChip,
  symbolFor,
} from "./triggerFormat";

const USDC = POPULAR_TOKENS.find((t) => t.mint === USDC_MINT)!;
const SOL = POPULAR_TOKENS.find((t) => t.mint === SOL_MINT)!;
const OTHER = "7GCihgDB8fe6KNjn2MYtkzZcRjQy3t9GHdC8uHYmW2hr";

function row(over: Partial<TriggerOrderRow> = {}): TriggerOrderRow {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    family: "price",
    state: "open",
    status: "open",
    inputMint: USDC_MINT,
    outputMint: SOL_MINT,
    inputAmountInitial: "100000000",
    inputAmountRemaining: "100000000",
    outputAmountReceived: null,
    createdAt: 1,
    updatedAt: 1,
    events: [],
    canCancel: true,
    canWithdraw: false,
    ...over,
  };
}

describe("isStableToken", () => {
  it("flags USDC, USDT and stablecoin-tagged tokens", () => {
    expect(isStableToken(USDC)).toBe(true);
    expect(isStableToken(POPULAR_TOKENS.find((t) => t.symbol === "USDT"))).toBe(true);
    expect(isStableToken({ mint: OTHER, tags: ["StableCoin"] })).toBe(true);
    expect(isStableToken(SOL)).toBe(false);
    expect(isStableToken(null)).toBe(false);
  });
});

describe("symbols and amounts", () => {
  it("falls back to the curated list, then a short mint", () => {
    expect(symbolFor(SOL_MINT, undefined)).toBe("SOL");
    expect(symbolFor(OTHER, { [OTHER]: { mint: OTHER, symbol: "ABC", decimals: 6 } })).toBe("ABC");
    expect(symbolFor(OTHER, undefined)).toBe("7GCi...W2hr");
  });

  it("formats base units with the token's decimals and never guesses", () => {
    expect(formatBaseAmount("1500000", USDC)).toBe("1.5 USDC");
    expect(formatBaseAmount("1234567890123", SOL, { withSymbol: false })).toBe("1,234.5678");
    expect(formatBaseAmount("100", undefined)).toBe("—");
    expect(formatBaseAmount("garbage", USDC)).toBe("—");
    expect(formatBaseAmount(null, USDC)).toBe("—");
  });
});

describe("order labels", () => {
  it("derives the side from the stable leg", () => {
    expect(rowSide(row())).toBe("buy");
    expect(rowSide(row({ inputMint: SOL_MINT, outputMint: USDC_MINT }))).toBe("sell");
    expect(rowSide(row({ inputMint: SOL_MINT, outputMint: OTHER }))).toBeNull();
    expect(orderTypeLabel(row())).toBe("Limit buy");
    expect(orderTypeLabel(row({ family: "dca", inputMint: SOL_MINT, outputMint: USDC_MINT }))).toBe("DCA sell");
    expect(orderTypeLabel(row({ family: "dca", inputMint: SOL_MINT, outputMint: OTHER }))).toBe("DCA");
  });

  it("picks the base mint (trigger mint first)", () => {
    expect(baseMintOf(row())).toBe(SOL_MINT);
    expect(baseMintOf(row({ inputMint: SOL_MINT, outputMint: USDC_MINT }))).toBe(SOL_MINT);
    expect(baseMintOf(row({ triggerMint: OTHER }))).toBe(OTHER);
  });

  it("labels statuses, including unknown ones, without throwing", () => {
    expect(statusChip(row()).label).toBe("Open");
    expect(statusChip(row({ status: "withdrawing", canWithdraw: true })).label).toBe("Needs withdraw");
    expect(statusChip(row({ status: "expired", canWithdraw: true })).label).toBe("Expired · funds held");
    const weird = statusChip(row({ status: "brand_new" as never, state: "brand_new" }));
    expect(weird.label).toBe("Unknown");
    expect(weird.title).toContain("brand_new");
  });

  it("shows filled share from fillPercent or rounds", () => {
    expect(fillPercentText(row({ fillPercent: 0.425 }))).toBe("42%");
    expect(fillPercentText(row({ fillPercent: 0.001 }))).toBe("<1%");
    expect(fillPercentText(row({ fillPercent: 3 }))).toBe("100%");
    expect(fillPercentText(row({ family: "dca", orderCount: 4, roundsFilled: 1 }))).toBe("25%");
    expect(fillPercentText(row({ status: "filled" }))).toBe("100%");
    expect(fillPercentText(row())).toBe("—");
    expect(roundsText(row({ orderCount: 4 }))).toBe("0 / 4");
    expect(roundsText(row())).toBe("—");
  });

  it("titles events", () => {
    expect(eventLabel("fill")).toBe("Fill");
    expect(eventLabel("pending_withdraw")).toBe("Pending withdraw");
    expect(eventLabel("")).toBe("Event");
  });
});

describe("time", () => {
  it("formats durations with two adjacent units at most", () => {
    expect(formatDuration(45)).toBe("45s");
    expect(formatDuration(60)).toBe("1m");
    expect(formatDuration(3 * 3600 + 20 * 60)).toBe("3h 20m");
    expect(formatDuration(6 * 86400 + 4 * 3600)).toBe("6d 4h");
    expect(formatDuration(7 * 86400 + 5 * 3600)).toBe("1w");
    expect(formatDuration(86400)).toBe("1d");
    expect(formatDuration(-1)).toBe("—");
  });

  it("names intervals", () => {
    expect(formatInterval(60)).toBe("every minute");
    expect(formatInterval(7200)).toBe("every 2 hours");
    expect(formatInterval(86400)).toBe("every day");
    expect(formatInterval(604800)).toBe("every week");
    expect(formatInterval(5400)).toBe("every 90 minutes");
    expect(formatInterval(3 * 3600 + 1800 + 7)).toBe("every 3h 30m");
    expect(formatInterval(0)).toBe("—");
  });

  it("counts down and handles the SSR clock", () => {
    expect(formatCountdown(10_000, 0)).toBe("—");
    expect(formatCountdown(undefined, 5)).toBe("—");
    expect(formatCountdown(1_000, 2_000, "expired")).toBe("expired");
    expect(formatCountdown(2_000 + 90_000, 2_000)).toBe("1m");
  });
});

describe("prices", () => {
  it("computes the distance from market", () => {
    expect(distancePct(140, 150)).toBeCloseTo(-6.6667, 3);
    expect(distancePct(165, 150)).toBeCloseTo(10, 6);
    expect(distancePct(null, 150)).toBeNull();
    expect(distancePct(1, 0)).toBeNull();
  });

  it("writes prices for inputs without exponent notation", () => {
    expect(priceToInput(150)).toBe("150");
    expect(priceToInput(0.0000123456789)).toBe("0.0000123457");
    expect(priceToInput(1e-9)).toBe("0.000000001");
    expect(priceToInput(NaN)).toBe("");
    expect(offsetPrice(150, -1)).toBe("148.5");
    expect(offsetPrice(150, 10)).toBe("165");
    expect(offsetPrice(null, 5)).toBe("");
  });
});

describe("lists", () => {
  it("merges open rows: dedupes by family+id, withdraw rows first, active copy wins", () => {
    const a = row({ id: "a" });
    const b = row({ id: "b", status: "needs_withdraw", canWithdraw: true, canCancel: false, state: "fresh" });
    const bOld = { ...b, state: "old" };
    const expired = row({ id: "c", status: "expired", canWithdraw: true, canCancel: false });
    const dcaA = row({ id: "a", family: "dca" });
    const out = mergeOpenRows([a, b, dcaA], [bOld, expired]);
    expect(out.map((r) => `${r.family}:${r.id}`)).toEqual(["price:b", "price:c", "price:a", "dca:a"]);
    expect(out[0].state).toBe("fresh");
  });

  it("describes a page", () => {
    expect(pageRangeText(0, 20, 57)).toBe("1–20 of 57");
    expect(pageRangeText(40, 17, 57)).toBe("41–57 of 57");
    expect(pageRangeText(0, 0, 0)).toBe("0");
    expect(pageRangeText(0, 3, 0)).toBe("1–3 of 3");
  });

  it("links only signature-shaped strings to Solscan", () => {
    const sig = "5".repeat(88);
    expect(solscanTx(sig)).toBe(`https://solscan.io/tx/${sig}`);
    expect(solscanTx("not a sig")).toBeNull();
    expect(solscanTx(undefined)).toBeNull();
  });
});

describe("failed after execution, unknown states", () => {
  it("labels held funds and unknown states", () => {
    const held = statusChip(row({ status: "failed", state: "withdraw_failed", fundsMayBeHeld: true }));
    expect(held.label).toBe("Failed · funds may be held");
    expect(held.title).toContain(FUNDS_MAY_BE_HELD_NOTE);
    expect(statusChip(row({ status: "unknown", state: "zzz" })).title).toMatch(/^Status not recognised/);
    expect(FUNDS_MAY_BE_HELD_NOTE).toMatch(/jup\.ag/);
  });

  it("marks withdraw_failed output as owed, not received", () => {
    expect(outputNotPaidOut(row({ state: "withdraw_failed", fundsMayBeHeld: true }))).toBe(true);
    expect(outputNotPaidOut(row({ state: "fill_failed", fundsMayBeHeld: true }))).toBe(false);
    expect(outputNotPaidOut(row({ state: "withdraw_failed" }))).toBe(false);
  });

  it("never calls the unknown-state action Withdraw", () => {
    expect(cancelLabel(row({ status: "unknown" }))).toBe("Cancel & withdraw");
    expect(cancelLabel(row())).toBe("Cancel");
  });
});

describe("paidSummary (history Paid)", () => {
  const cancelled = { status: "cancelled" as const, state: "cancelled", inputAmountRemaining: "0", canCancel: false };

  it("shows what was spent and what went back", () => {
    expect(paidSummary(row({ ...cancelled, inputAmountUsed: "25000000" }))).toEqual({
      paid: "25000000",
      deposited: "100000000",
      remainder: "75000000",
      remainderLabel: "refunded",
    });
    expect(paidSummary(row({ inputAmountUsed: "100000000" }))).toMatchObject({ paid: "100000000", remainder: null });
    expect(paidSummary(row({ inputAmountUsed: "0" }))).toMatchObject({ paid: "0", remainder: "100000000" });
    // Capped at the deposit.
    expect(paidSummary(row({ inputAmountUsed: "500000000" }))).toMatchObject({ paid: "100000000", remainder: null });
  });

  it("says where the remainder is", () => {
    expect(paidSummary(row({ inputAmountUsed: "0", canWithdraw: true })).remainderLabel).toBe("in vault");
    expect(paidSummary(row({ inputAmountUsed: "0", fundsMayBeHeld: true })).remainderLabel).toBe("may be held");
    expect(paidSummary(row({ ...cancelled, inputAmountUsed: "0" })).remainderLabel).toBe("refunded");
    expect(
      paidSummary(row({ status: "filled", state: "fill_success", inputAmountRemaining: "0", inputAmountUsed: "90000000" }))
        .remainderLabel
    ).toBe("refunded");
  });

  it("keeps an expired order's remainder in the vault until it is withdrawn", () => {
    const expired = { status: "expired" as const, inputAmountUsed: "40000000", canCancel: false };
    // Withdrawable expired order.
    expect(
      paidSummary(row({ ...expired, state: "expired", inputAmountRemaining: "60000000", canWithdraw: true }))
    ).toMatchObject({ remainder: "60000000", remainderLabel: "in vault" });
    // ready_expire: Withdraw not offered yet, but the funds are still there.
    expect(
      paidSummary(row({ ...expired, state: "ready_expire", inputAmountRemaining: "60000000", canWithdraw: false }))
    ).toMatchObject({ remainder: "60000000", remainderLabel: "in vault" });
    // Already withdrawn: nothing remaining.
    expect(
      paidSummary(row({ ...expired, state: "expired", inputAmountRemaining: "0", canWithdraw: false })).remainderLabel
    ).toBe("refunded");
  });

  it("a failed deposit has no remainder", () => {
    const s = paidSummary(
      row({ status: "failed", state: "deposit_failed", inputAmountRemaining: "0", inputAmountUsed: "0", canCancel: false })
    );
    expect(s).toEqual({
      paid: null,
      deposited: "100000000",
      remainder: null,
      remainderLabel: "not deposited",
      notDeposited: true,
    });
  });

  it("never calls a live or failed order's rest refunded", () => {
    expect(paidSummary(row({ inputAmountUsed: "10000000" })).remainderLabel).toBe("unfilled");
    expect(
      paidSummary(row({ status: "failed", state: "failed", inputAmountRemaining: "0", inputAmountUsed: "0" })).remainderLabel
    ).toBe("unspent");
    expect(remainderNeedsAttention("in vault")).toBe(true);
    expect(remainderNeedsAttention("may be held")).toBe(true);
    expect(remainderNeedsAttention("refunded")).toBe(false);
  });

  it("only knows the deposit when Jupiter does not report the amount spent", () => {
    expect(paidSummary(row())).toMatchObject({ paid: null, deposited: "100000000", remainder: null });
  });
});

describe("minimumText", () => {
  it("nudges near the minimum", () => {
    expect(minimumText(10, false)).toBe("$10 minimum");
    expect(minimumText(10, true)).toBe("$10 minimum (we suggest a little more)");
  });
});
