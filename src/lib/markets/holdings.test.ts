import { describe, expect, it } from "vitest";
import { SOL_MINT } from "@/lib/constants";
import { buildHoldings, sumTokenAccounts } from "./holdings";

const JUP = "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN";
const PUMP = "pumpCmXqMfrsAkQ5r49WcJnRayYRqmXz6ae8H7H9Dfn";

const acct = (mint: unknown, amount: unknown, decimals: unknown) => ({
  account: { data: { parsed: { info: { mint, tokenAmount: { amount, decimals } } } } },
});

describe("sumTokenAccounts", () => {
  it("sums accounts per mint across both programs, exactly, with decimals", () => {
    const out = sumTokenAccounts([
      { value: [acct(JUP, "18446744073709551615", 6), acct(JUP, "1", 6)] },
      { value: [acct(PUMP, "5", 6)] },
    ]);
    expect(out).toEqual({
      [JUP]: { raw: "18446744073709551616", decimals: 6 },
      [PUMP]: { raw: "5", decimals: 6 },
    });
  });

  it("skips malformed accounts and mints without decimals", () => {
    const out = sumTokenAccounts([
      {
        value: [
          { account: { data: "base64" } },
          { account: { data: null } },
          acct(5, "1", 6),
          acct(JUP, "-1", 6),
          acct(JUP, "1.5", 6),
          acct(PUMP, "3", "6"),
        ],
      },
    ]);
    expect(out).toEqual({});
  });
});

describe("buildHoldings", () => {
  it("lists native SOL first (even at zero), then non-zero SPL holdings", () => {
    expect(
      buildHoldings("0", {
        [PUMP]: { raw: "7", decimals: 6 },
        [JUP]: { raw: "0", decimals: 6 },
        [SOL_MINT]: { raw: "99", decimals: 9 },
      })
    ).toEqual([
      { mint: SOL_MINT, raw: "0", decimals: 9 },
      { mint: PUMP, raw: "7", decimals: 6 },
    ]);
  });

  it("handles missing parts", () => {
    expect(buildHoldings(undefined, undefined)).toEqual([]);
    expect(buildHoldings("12", undefined)).toEqual([{ mint: SOL_MINT, raw: "12", decimals: 9 }]);
  });
});
