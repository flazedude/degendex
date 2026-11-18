import { describe, expect, it } from "vitest";
import BigNumber from "bignumber.js";
import { SOL_MINT, USDC_MINT } from "@/lib/constants";
import {
  SOL_FEE_RESERVE_LAMPORTS,
  exceedsBalance,
  formatRate,
  getSpendableRaw,
  portionAmount,
  routeText,
  slippageDisplay,
  slippageLabel,
} from "./swapDetails";

describe("getSpendableRaw / portionAmount", () => {
  it("is null while the balance is unknown", () => {
    expect(getSpendableRaw(undefined, USDC_MINT)).toBeNull();
  });

  it("keeps the 0.01 SOL reserve for native SOL only", () => {
    expect(getSpendableRaw("1000000000", SOL_MINT)!.toFixed()).toBe(
      String(1_000_000_000 - SOL_FEE_RESERVE_LAMPORTS)
    );
    expect(getSpendableRaw("5000000", SOL_MINT)!.toFixed()).toBe("0");
    expect(getSpendableRaw("1000000", USDC_MINT)!.toFixed()).toBe("1000000");
  });

  it("rounds portions down and returns empty for zero", () => {
    expect(portionAmount(new BigNumber("1000001"), 0.5, 6)).toBe("0.5");
    expect(portionAmount(new BigNumber("990000000"), 1, 9)).toBe("0.99");
    expect(portionAmount(new BigNumber("3"), 0.25, 6)).toBe("");
    expect(portionAmount(new BigNumber("0"), 1, 6)).toBe("");
  });
});

describe("exceedsBalance", () => {
  it("only when both are known and the amount is larger", () => {
    expect(exceedsBalance("101", "100")).toBe(true);
    expect(exceedsBalance("100", "100")).toBe(false);
    expect(exceedsBalance(null, "100")).toBe(false);
    expect(exceedsBalance("101", undefined)).toBe(false);
    expect(exceedsBalance("18446744073709551615", "18446744073709551614")).toBe(true);
  });
});

describe("formatRate", () => {
  const usdc = { symbol: "USDC", decimals: 6 };
  const sol = { symbol: "SOL" };
  it("both directions", () => {
    const order = { inAmount: "150000000" }; // 150 USDC
    expect(formatRate(order, "1", usdc, sol, false)).toBe("1 USDC = 0.006666 SOL");
    expect(formatRate(order, "1", usdc, sol, true)).toBe("1 SOL = 150 USDC");
  });
  it("null without a positive quote", () => {
    expect(formatRate(null, "1", usdc, sol, false)).toBeNull();
    expect(formatRate({ inAmount: "0" }, "1", usdc, sol, false)).toBeNull();
    expect(formatRate({ inAmount: "1" }, "", usdc, sol, false)).toBeNull();
  });
});

describe("routeText", () => {
  it("names known routers and joins labels", () => {
    expect(routeText("metis", ["Raydium", "Orca"])).toBe("Metis: Raydium › Orca");
    expect(routeText("newrouter", [])).toBe("newrouter");
    expect(routeText(null, ["Meteora"])).toBe("Meteora");
    expect(routeText(null, [])).toBe("—");
  });
});

describe("slippageDisplay", () => {
  const base = { router: "metis", transaction: "AQID", slippageBps: 37 };
  it("RFQ fills at the quote", () => {
    expect(slippageDisplay({ ...base, router: "jupiterz", transaction: null }, "auto")).toEqual({
      slippageText: "Fixed price (RFQ)",
      minReceivedUnknown: false,
    });
  });
  it("no wallet + auto: minimum is not known", () => {
    expect(slippageDisplay({ ...base, transaction: null }, "auto")).toEqual({
      slippageText: "Auto (set when you connect)",
      minReceivedUnknown: true,
    });
    expect(slippageDisplay({ ...base, transaction: null }, 50)).toEqual({
      slippageText: "0.5%",
      minReceivedUnknown: false,
    });
  });
  it("with a wallet shows the order's slippage", () => {
    expect(slippageDisplay(base, "auto").slippageText).toBe("Auto (0.37%)");
    expect(slippageDisplay(base, 100).slippageText).toBe("0.37%");
    expect(slippageDisplay({ ...base, slippageBps: NaN }, 100).slippageText).toBe("1%");
    expect(slippageDisplay(null, "auto")).toEqual({ slippageText: "Auto", minReceivedUnknown: false });
  });
  it("slippageLabel", () => {
    expect(slippageLabel("auto")).toBe("Auto");
    expect(slippageLabel(250)).toBe("2.5%");
  });
});
