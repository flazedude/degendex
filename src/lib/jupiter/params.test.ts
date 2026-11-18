import { describe, expect, it } from "vitest";
import {
  buildOrderQuery,
  isValidPubkey,
  normalizeSlippageSetting,
  parseRawAmount,
  parseReferralConfig,
  parseSlippageBps,
  validateExecuteBody,
  validateOrderParams,
  validateTokenQuery,
} from "./params";

const SOL = "So11111111111111111111111111111111111111112";
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const WALLET = "2F5Pa8UBDVBtnR7q949AWmgpeQYrJKhRVLnRjqQPRkMm";

const qs = (o: Record<string, string>) => new URLSearchParams(o);

describe("isValidPubkey", () => {
  it("accepts real pubkeys", () => {
    expect(isValidPubkey(SOL)).toBe(true);
    expect(isValidPubkey(USDC)).toBe(true);
    expect(isValidPubkey("11111111111111111111111111111111")).toBe(true);
    expect(isValidPubkey("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb")).toBe(true);
  });

  it("rejects invalid strings", () => {
    expect(isValidPubkey("")).toBe(false);
    expect(isValidPubkey("abc")).toBe(false);
    expect(isValidPubkey(SOL + "1")).toBe(false); // 33 bytes
    expect(isValidPubkey("0" + SOL.slice(1))).toBe(false); // 0 not base58
    expect(isValidPubkey("O" + SOL.slice(1))).toBe(false);
    expect(isValidPubkey("1111111111111111111111111111111")).toBe(false); // 31 bytes
    expect(isValidPubkey("zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz")).toBe(false); // > 32 bytes
    expect(isValidPubkey(` ${SOL}`)).toBe(false);
    expect(isValidPubkey(123)).toBe(false);
    expect(isValidPubkey(null)).toBe(false);
  });
});

describe("parseRawAmount", () => {
  it("accepts positive integers up to u64 max", () => {
    expect(parseRawAmount("1")).toBe("1");
    expect(parseRawAmount("18446744073709551615")).toBe("18446744073709551615");
    expect(parseRawAmount("0001")).toBe("1");
  });

  it("rejects the rest", () => {
    for (const bad of ["", "0", "000", "-1", "+1", "1.5", "1e9", " 1", "18446744073709551616", "999999999999999999999", "abc"]) {
      expect(parseRawAmount(bad), bad).toBeNull();
    }
    expect(parseRawAmount(5)).toBeNull();
  });
});

describe("parseSlippageBps", () => {
  it("bounds 0..10000", () => {
    expect(parseSlippageBps("0")).toBe(0);
    expect(parseSlippageBps("50")).toBe(50);
    expect(parseSlippageBps("10000")).toBe(10000);
    expect(parseSlippageBps("10001")).toBeNull();
    expect(parseSlippageBps("-1")).toBeNull();
    expect(parseSlippageBps("0.5")).toBeNull();
    expect(parseSlippageBps("")).toBeNull();
  });
});

describe("validateOrderParams", () => {
  it("accepts a minimal order", () => {
    const r = validateOrderParams(qs({ inputMint: SOL, outputMint: USDC, amount: "1000" }));
    expect(r).toEqual({ ok: true, value: { inputMint: SOL, outputMint: USDC, amount: "1000" } });
  });

  it("accepts taker and slippage", () => {
    const r = validateOrderParams(
      qs({ inputMint: SOL, outputMint: USDC, amount: "1000", taker: WALLET, slippageBps: "100" })
    );
    expect(r.ok && r.value).toEqual({
      inputMint: SOL,
      outputMint: USDC,
      amount: "1000",
      taker: WALLET,
      slippageBps: 100,
    });
  });

  it("drops unknown params", () => {
    const r = validateOrderParams(
      qs({ inputMint: SOL, outputMint: USDC, amount: "1", payer: WALLET, referralFee: "255" })
    );
    expect(r.ok && Object.keys(r.value)).toEqual(["inputMint", "outputMint", "amount"]);
  });

  it("rejects bad input", () => {
    const cases: Record<string, string>[] = [
      { outputMint: USDC, amount: "1" },
      { inputMint: "bad", outputMint: USDC, amount: "1" },
      { inputMint: SOL, outputMint: SOL, amount: "1" },
      { inputMint: SOL, outputMint: USDC, amount: "0" },
      { inputMint: SOL, outputMint: USDC, amount: "1.5" },
      { inputMint: SOL, outputMint: USDC, amount: "18446744073709551616" },
      { inputMint: SOL, outputMint: USDC, amount: "1", taker: "nope" },
      { inputMint: SOL, outputMint: USDC, amount: "1", slippageBps: "10001" },
    ];
    for (const c of cases) expect(validateOrderParams(qs(c)).ok, JSON.stringify(c)).toBe(false);
  });

  it("rejects duplicated params", () => {
    const p = new URLSearchParams(`inputMint=${SOL}&outputMint=${USDC}&amount=1&amount=2`);
    expect(validateOrderParams(p).ok).toBe(false);
  });
});

describe("referral config + query", () => {
  it("requires both values and a fee in 50..255", () => {
    expect(parseReferralConfig(undefined, undefined)).toEqual({ config: null });
    expect(parseReferralConfig(WALLET, undefined).warning).toBeTruthy();
    expect(parseReferralConfig(undefined, "100").warning).toBeTruthy();
    expect(parseReferralConfig("bad", "100").config).toBeNull();
    expect(parseReferralConfig(WALLET, "49").config).toBeNull();
    expect(parseReferralConfig(WALLET, "256").config).toBeNull();
    expect(parseReferralConfig(WALLET, "50.5").config).toBeNull();
    expect(parseReferralConfig(WALLET, "50").config).toEqual({ referralAccount: WALLET, referralFee: 50 });
    expect(parseReferralConfig(WALLET, " 255 ").config).toEqual({ referralAccount: WALLET, referralFee: 255 });
  });

  it("builds only allowlisted upstream params", () => {
    const q = buildOrderQuery(
      { inputMint: SOL, outputMint: USDC, amount: "5", taker: WALLET, slippageBps: 0 },
      { referralAccount: WALLET, referralFee: 100 }
    );
    expect(Object.fromEntries(q)).toEqual({
      inputMint: SOL,
      outputMint: USDC,
      amount: "5",
      taker: WALLET,
      slippageBps: "0",
      referralAccount: WALLET,
      referralFee: "100",
    });
    expect(buildOrderQuery({ inputMint: SOL, outputMint: USDC, amount: "5" }, null).toString()).toBe(
      `inputMint=${SOL}&outputMint=${USDC}&amount=5`
    );
  });
});

describe("validateExecuteBody", () => {
  const tx = "AQID".repeat(10);
  it("accepts a valid body and drops extras", () => {
    expect(validateExecuteBody({ signedTransaction: tx, requestId: "abc-123", extra: 1 })).toEqual({
      ok: true,
      value: { signedTransaction: tx, requestId: "abc-123" },
    });
  });

  it("rejects invalid bodies", () => {
    const bad: unknown[] = [
      null,
      "str",
      [],
      {},
      { signedTransaction: tx },
      { signedTransaction: "", requestId: "a" },
      { signedTransaction: "AQI", requestId: "a" }, // bad length
      { signedTransaction: "AQ!D", requestId: "a" },
      { signedTransaction: "A".repeat(4100), requestId: "a" },
      { signedTransaction: tx, requestId: "" },
      { signedTransaction: tx, requestId: "a/b" },
      { signedTransaction: tx, requestId: "a".repeat(129) },
      { signedTransaction: tx, requestId: 5 },
    ];
    for (const b of bad) expect(validateExecuteBody(b).ok, JSON.stringify(b)).toBe(false);
  });
});

describe("validateTokenQuery", () => {
  it("trims and bounds", () => {
    expect(validateTokenQuery("  bonk ")).toEqual({ ok: true, value: "bonk" });
    expect(validateTokenQuery("   ").ok).toBe(false);
    expect(validateTokenQuery(null).ok).toBe(false);
    expect(validateTokenQuery("a".repeat(2000)).ok).toBe(true);
    expect(validateTokenQuery("a".repeat(2001)).ok).toBe(false);
  });
});

describe("normalizeSlippageSetting", () => {
  it("keeps valid settings and coerces the rest to auto", () => {
    expect(normalizeSlippageSetting("auto")).toBe("auto");
    expect(normalizeSlippageSetting(50)).toBe(50);
    expect(normalizeSlippageSetting(1)).toBe(1);
    expect(normalizeSlippageSetting(5000)).toBe(5000);
    expect(normalizeSlippageSetting(0)).toBe("auto");
    expect(normalizeSlippageSetting(5001)).toBe("auto");
    expect(normalizeSlippageSetting(1.5)).toBe("auto");
    expect(normalizeSlippageSetting("50")).toBe("auto");
    expect(normalizeSlippageSetting(undefined)).toBe("auto");
  });
});
