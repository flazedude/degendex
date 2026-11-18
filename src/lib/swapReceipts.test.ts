import { describe, expect, it } from "vitest";
import { SOL_MINT, USDC_MINT } from "@/lib/constants";
import { bytesToBase58 } from "@/lib/jupiter/encoding";
import { parseSwapReceipt, receiptFromExecute } from "./swapReceipts";

const context = {
  wallet: bytesToBase58(new Uint8Array(32).fill(3)),
  signature: bytesToBase58(new Uint8Array(64).fill(5)),
  confirmedAt: Date.parse("2026-10-20T13:00:00Z"),
  input: { mint: SOL_MINT, symbol: "SOL", decimals: 9 },
  output: { mint: USDC_MINT, symbol: "USDC", decimals: 6 },
};

describe("swap receipt amounts", () => {
  it("uses wallet totals and preserves exact base units", () => {
    expect(receiptFromExecute(context, {
      status: "Success",
      code: 0,
      totalInputAmount: "0100000000",
      totalOutputAmount: "18446744073709551615",
      inputAmountResult: "99999997",
      outputAmountResult: "1000000",
    })).toEqual({
      ...context,
      inputAmountRaw: "100000000",
      outputAmountRaw: "18446744073709551615",
    });
  });

  it("keeps missing or invalid wallet totals unavailable", () => {
    expect(receiptFromExecute(context, {
      status: "Success",
      code: 0,
      inputAmountResult: "100000000",
      totalOutputAmount: "18446744073709551616",
    })).toMatchObject({ inputAmountRaw: null, outputAmountRaw: null });
  });

  it("does not write receipts for a failed, inconsistent, or unsigned result", () => {
    expect(receiptFromExecute(context, { status: "Failed", code: -1001 })).toBeNull();
    expect(receiptFromExecute(context, { status: "Success", code: -1001 })).toBeNull();
    expect(receiptFromExecute({ ...context, signature: undefined }, { status: "Success", code: 0 })).toBeNull();
  });
});

describe("persisted receipt validation", () => {
  it("rejects invalid owners, signatures, times and decimals", () => {
    expect(parseSwapReceipt({ ...context, wallet: "other-wallet" })).toBeNull();
    expect(parseSwapReceipt({ ...context, signature: context.wallet })).toBeNull();
    expect(parseSwapReceipt({ ...context, confirmedAt: Infinity })).toBeNull();
    expect(parseSwapReceipt({ ...context, input: { ...context.input, decimals: 256 } })).toBeNull();
  });

  it("keeps only display metadata and permits missing fill amounts", () => {
    const parsed = parseSwapReceipt({
      ...context,
      signedTransaction: "do not retain",
      input: { ...context.input, tokenName: "not stored" },
      outputAmountRaw: "0",
    });
    expect(parsed).toEqual({ ...context, inputAmountRaw: null, outputAmountRaw: "0" });
  });
});
