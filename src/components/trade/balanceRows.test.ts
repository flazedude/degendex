import { describe, expect, it } from "vitest";
import { SOL_MINT, USDC_MINT, BONK_MINT } from "@/lib/constants";
import type { WalletHolding } from "@/lib/markets/types";
import type { TokenInfo } from "@/lib/tokens/types";
import { buildBalanceRows, totalValueUsd } from "./balanceRows";

const UNKNOWN = "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin";
const SPAM = "4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R";

const meta: Record<string, TokenInfo> = {
  [SOL_MINT]: { mint: SOL_MINT, symbol: "SOL", decimals: 9, isVerified: true, logoURI: "sol.png" },
  [USDC_MINT]: { mint: USDC_MINT, symbol: "USDC", decimals: 6, isVerified: true },
  [BONK_MINT]: { mint: BONK_MINT, symbol: "BONK", decimals: 5, isVerified: true },
  [SPAM]: { mint: SPAM, symbol: "FAKE", decimals: 6, isVerified: false },
};

const prices = {
  [SOL_MINT]: { usdPrice: 107, change24hPct: -1.33 },
  [USDC_MINT]: { usdPrice: 1, change24hPct: 0.01 },
  [BONK_MINT]: { usdPrice: 0.00000322, change24hPct: null },
};

const holdings: WalletHolding[] = [
  { mint: SOL_MINT, raw: "1500000000", decimals: 9 }, // 1.5 SOL = $160.5
  { mint: USDC_MINT, raw: "250000000", decimals: 6 }, // 250 USDC
  { mint: BONK_MINT, raw: "100000", decimals: 5 }, // 1 BONK = dust
  { mint: UNKNOWN, raw: "42", decimals: 0 }, // no metadata, no price
  { mint: SPAM, raw: "1000000", decimals: 6 }, // known, unpriced
];

describe("buildBalanceRows", () => {
  it("sorts by value desc, unpriced last (known before unknown)", () => {
    const rows = buildBalanceRows(holdings, meta, prices, SOL_MINT);
    expect(rows.map((r) => r.symbol)).toEqual(["USDC", "SOL", "BONK", "FAKE", "9xQe...VFin"]);
  });

  it("computes exact UI amounts from base units and display values", () => {
    const rows = buildBalanceRows(holdings, meta, prices, SOL_MINT);
    const sol = rows.find((r) => r.mint === SOL_MINT)!;
    expect(sol.ui).toBe("1.5");
    expect(sol.balance).toBe("1.5");
    expect(sol.valueUsd).toBeCloseTo(160.5, 9);
    expect(sol.change24hPct).toBe(-1.33);
    expect(sol.isCurrent).toBe(true);
    expect(sol.logoURI).toBe("sol.png");
    expect(rows.filter((r) => r.isCurrent)).toHaveLength(1);
  });

  it("keeps precision past float range", () => {
    const rows = buildBalanceRows(
      [{ mint: USDC_MINT, raw: "123456789123456789", decimals: 9 }],
      meta,
      undefined,
      null
    );
    expect(rows[0].ui).toBe("123456789.123456789");
    expect(rows[0].valueUsd).toBeNull();
    expect(rows[0].priceUsd).toBeNull();
  });

  it("flags dust: zero balances and priced balances under $0.01, not unpriced ones", () => {
    const rows = buildBalanceRows(
      [...holdings, { mint: "7GCihgDB8fe6KNjn2MYtkzZcRjQy3t9GHdC8uHYmW2hr", raw: "0", decimals: 9 }],
      meta,
      prices,
      null
    );
    const dust = Object.fromEntries(rows.map((r) => [r.mint, r.isDust]));
    expect(dust[BONK_MINT]).toBe(true);
    expect(dust["7GCihgDB8fe6KNjn2MYtkzZcRjQy3t9GHdC8uHYmW2hr"]).toBe(true);
    expect(dust[UNKNOWN]).toBe(false);
    expect(dust[SPAM]).toBe(false);
    expect(dust[SOL_MINT]).toBe(false);
  });

  it("marks unknown tokens and uses the short mint as symbol", () => {
    const rows = buildBalanceRows(holdings, meta, prices, null);
    const unknown = rows.find((r) => r.mint === UNKNOWN)!;
    expect(unknown.known).toBe(false);
    expect(unknown.isVerified).toBe(false);
    expect(unknown.symbol).toBe("9xQe...VFin");
    const spam = rows.find((r) => r.mint === SPAM)!;
    expect(spam.known).toBe(true);
    expect(spam.isVerified).toBe(false);
  });

  it("works before metadata and prices load", () => {
    const rows = buildBalanceRows(holdings, undefined, undefined, null);
    expect(rows).toHaveLength(holdings.length);
    expect(rows.every((r) => r.valueUsd === null && !r.known)).toBe(true);
  });

  it("ignores invalid prices", () => {
    const rows = buildBalanceRows(
      [{ mint: SOL_MINT, raw: "1000000000", decimals: 9 }],
      meta,
      { [SOL_MINT]: { usdPrice: NaN, change24hPct: NaN } },
      null
    );
    expect(rows[0].priceUsd).toBeNull();
    expect(rows[0].change24hPct).toBeNull();
  });
});

describe("totalValueUsd", () => {
  it("sums priced rows only", () => {
    const rows = buildBalanceRows(holdings, meta, prices, null);
    expect(totalValueUsd(rows)).toBeCloseTo(410.50000322, 6);
    expect(totalValueUsd(buildBalanceRows(holdings, meta, undefined, null))).toBeNull();
  });
});
