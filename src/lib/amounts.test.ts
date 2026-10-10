import { describe, expect, it } from "vitest";
import {
  formatTokenAmount,
  formatUsd,
  fromBaseUnits,
  safeBigNumber,
  sanitizeAmount,
  toBaseUnits,
  truncateToDecimals,
} from "./amounts";

describe("toBaseUnits", () => {
  it("converts across common decimals", () => {
    expect(toBaseUnits("1", 9)).toBe("1000000000");
    expect(toBaseUnits("1.5", 6)).toBe("1500000");
    expect(toBaseUnits("0.00001", 5)).toBe("1");
    expect(toBaseUnits("42", 0)).toBe("42");
    expect(toBaseUnits(".5", 6)).toBe("500000");
    expect(toBaseUnits("5.", 6)).toBe("5000000");
    expect(toBaseUnits(" 2 ", 6)).toBe("2000000");
  });

  it("is exact beyond float precision", () => {
    expect(toBaseUnits("123456789.123456789", 9)).toBe("123456789123456789");
    expect(toBaseUnits("0.1", 9)).toBe("100000000");
    expect(toBaseUnits("1.005", 3)).toBe("1005");
    expect(toBaseUnits("9007199254.740993", 6)).toBe("9007199254740993");
  });

  it("rounds extra decimals down", () => {
    expect(toBaseUnits("1.1234567", 6)).toBe("1123456");
    expect(toBaseUnits("0.0000009", 6)).toBeNull(); // rounds to zero
    expect(toBaseUnits("1.9", 0)).toBe("1");
  });

  it("rejects invalid input", () => {
    for (const bad of ["", " ", ".", "abc", "-1", "+1", "1e9", "1,5", "1.2.3", "NaN", "Infinity", "0", "0.000", "0x10"]) {
      expect(toBaseUnits(bad, 6), bad).toBeNull();
    }
  });

  it("rejects u64 overflow and bad decimals", () => {
    expect(toBaseUnits("18446744073709551615", 0)).toBe("18446744073709551615");
    expect(toBaseUnits("18446744073709551616", 0)).toBeNull();
    expect(toBaseUnits("18446744074", 9)).toBeNull();
    expect(toBaseUnits("1", -1)).toBeNull();
    expect(toBaseUnits("1", 1.5)).toBeNull();
  });
});

describe("fromBaseUnits", () => {
  it("converts exactly", () => {
    expect(fromBaseUnits("1000000000", 9)).toBe("1");
    expect(fromBaseUnits("123456789123456789", 9)).toBe("123456789.123456789");
    expect(fromBaseUnits("1", 9)).toBe("0.000000001");
    expect(fromBaseUnits("1500000", 6)).toBe("1.5");
    expect(fromBaseUnits("12345", 5)).toBe("0.12345");
    expect(fromBaseUnits("42", 0)).toBe("42");
    expect(fromBaseUnits(BigInt("18446744073709551615"), 9)).toBe("18446744073.709551615");
    expect(fromBaseUnits("0", 6)).toBe("0");
  });

  it("returns 0 for garbage", () => {
    expect(fromBaseUnits("abc", 6)).toBe("0");
    expect(fromBaseUnits("1", -2)).toBe("0");
  });

  it("round-trips", () => {
    expect(toBaseUnits(fromBaseUnits("987654321987654321", 9), 9)).toBe("987654321987654321");
  });
});

describe("formatTokenAmount", () => {
  it("formats large and mid values with grouping, rounding down", () => {
    expect(formatTokenAmount("1234567.891")).toBe("1,234,567.89");
    expect(formatTokenAmount("12.3456789")).toBe("12.3456");
    expect(formatTokenAmount("1.99999")).toBe("1.9999");
    expect(formatTokenAmount(5)).toBe("5");
  });

  it("keeps significant digits for tiny values", () => {
    expect(formatTokenAmount("0.00001234567")).toBe("0.00001234");
    expect(formatTokenAmount("0.5")).toBe("0.5");
    expect(formatTokenAmount("0.000000000000001")).toBe("<0.000000000001");
  });

  it("handles zero and invalid", () => {
    expect(formatTokenAmount("0")).toBe("0");
    expect(formatTokenAmount("nope")).toBe("—");
  });

  it("respects options", () => {
    expect(formatTokenAmount("1.123456789", { maxDecimals: 6 })).toBe("1.123456");
    expect(formatTokenAmount("0.123456789", { significant: 6 })).toBe("0.123456");
  });
});

describe("formatUsd", () => {
  it("formats", () => {
    expect(formatUsd(1234.567)).toBe("$1,234.57");
    expect(formatUsd(0.001)).toBe("<$0.01");
    expect(formatUsd(undefined)).toBeNull();
    expect(formatUsd(NaN)).toBeNull();
  });
});

describe("safeBigNumber", () => {
  it("never throws", () => {
    expect(safeBigNumber("12.5").toFixed()).toBe("12.5");
    expect(safeBigNumber("nope").isNaN()).toBe(true);
    expect(safeBigNumber("").isNaN()).toBe(true);
    expect(safeBigNumber(undefined).isNaN()).toBe(true);
  });
});

describe("truncateToDecimals", () => {
  it("cuts extra fraction digits without rounding up", () => {
    expect(truncateToDecimals("0.123456789", 6)).toBe("0.123456");
    expect(truncateToDecimals("1.999999999", 6)).toBe("1.999999");
    expect(truncateToDecimals("1.5", 6)).toBe("1.5");
    expect(truncateToDecimals("12", 6)).toBe("12");
  });

  it("drops the decimal point for 0 decimals", () => {
    expect(truncateToDecimals("1.5", 0)).toBe("1");
    expect(truncateToDecimals("7.", 0)).toBe("7");
    expect(truncateToDecimals("3.", 6)).toBe("3");
  });

  it("returns '' for empty, zero or malformed results", () => {
    expect(truncateToDecimals("", 6)).toBe("");
    expect(truncateToDecimals("0.0000001", 6)).toBe("");
    expect(truncateToDecimals("0.5", 0)).toBe("");
    expect(truncateToDecimals("0", 6)).toBe("");
    expect(truncateToDecimals("abc", 6)).toBe("");
    expect(truncateToDecimals(".5", 6)).toBe("0.5");
  });
});

describe("sanitizeAmount", () => {
  it("accepts plain decimals and normalises leading zeros / dot", () => {
    expect(sanitizeAmount("", 6)).toBe("");
    expect(sanitizeAmount("12.5", 6)).toBe("12.5");
    expect(sanitizeAmount(".5", 6)).toBe("0.5");
    expect(sanitizeAmount("0007", 6)).toBe("7");
    expect(sanitizeAmount("00.5", 6)).toBe("0.5");
    expect(sanitizeAmount(" 1 000 ", 6)).toBe("1000");
  });

  it("treats a single lone comma as a decimal comma", () => {
    expect(sanitizeAmount("1,5", 6)).toBe("1.5");
    expect(sanitizeAmount(",5", 6)).toBe("0.5");
    expect(sanitizeAmount("1,000", 6)).toBe("1.000");
  });

  it("strips grouping commas when there is also a dot or several commas", () => {
    expect(sanitizeAmount("1,000,000", 6)).toBe("1000000");
    expect(sanitizeAmount("1,234.56", 6)).toBe("1234.56");
    expect(sanitizeAmount("1.234,56", 6)).toBeNull();
  });

  it("rejects malformed input", () => {
    expect(sanitizeAmount("1e5", 6)).toBeNull();
    expect(sanitizeAmount("..", 6)).toBeNull();
    expect(sanitizeAmount("1.2.3", 6)).toBeNull();
    expect(sanitizeAmount("-1", 6)).toBeNull();
    expect(sanitizeAmount("1".repeat(41), 6)).toBeNull();
  });

  it("caps fraction digits at the token decimals", () => {
    expect(sanitizeAmount("1.123456", 6)).toBe("1.123456");
    expect(sanitizeAmount("1.1234567", 6)).toBeNull();
    expect(sanitizeAmount("1.", 0)).toBeNull();
    expect(sanitizeAmount("15", 0)).toBe("15");
  });
});
