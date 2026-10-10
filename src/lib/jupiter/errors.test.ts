import { describe, expect, it } from "vitest";
import {
  EXECUTE_UNKNOWN_STATUS_CODE,
  describeExecuteError,
  describeOrderError,
  isUnknownExecuteOutcome,
  isUserRejection,
} from "./errors";

describe("describeOrderError", () => {
  it("maps aggregator codes", () => {
    for (const r of ["metis", "dflow", "okx"]) {
      expect(describeOrderError(r, 1)).toBe("Insufficient balance");
      expect(describeOrderError(r, 2)).toBe("Not enough SOL for network fees");
      expect(describeOrderError(r, 3)).toBe("Amount too small for a gasless swap");
    }
  });

  it("maps jupiterz codes differently", () => {
    expect(describeOrderError("jupiterz", 1)).toBe("Insufficient balance");
    expect(describeOrderError("jupiterz", 2)).toBe("Missing token account for this swap");
    expect(describeOrderError("jupiterz", 3)).toBe("Quote could not be built, retrying");
  });

  it("falls back to the message, then a default", () => {
    expect(describeOrderError("metis", 99, "Something odd")).toBe("Something odd");
    expect(describeOrderError(undefined, undefined, "x".repeat(200)).length).toBeLessThanOrEqual(90);
    expect(describeOrderError("newrouter", 1)).toBe("Swap unavailable for this quote");
  });
});

describe("describeExecuteError", () => {
  it("says a rejected-before-broadcast swap was not submitted", () => {
    expect(describeExecuteError(-10001)).toMatch(/nothing was submitted/i);
    expect(isUnknownExecuteOutcome(-10001)).toBe(false);
  });
  it("maps known codes", () => {
    expect(describeExecuteError(-1)).toMatch(/expired/i);
    expect(describeExecuteError(-2003)).toMatch(/expired/i);
    expect(describeExecuteError(-1000)).toMatch(/failed to land/i);
    expect(describeExecuteError(-2000)).toMatch(/failed to land/i);
    expect(describeExecuteError(-1003)).toMatch(/not fully signed/i);
    expect(describeExecuteError(-2004)).toMatch(/rejected/i);
    expect(describeExecuteError(EXECUTE_UNKNOWN_STATUS_CODE)).toMatch(/unknown/i);
  });

  it("uses error text for unknown failures", () => {
    expect(describeExecuteError(-1001, "custom program error: 0x1771")).toBe(
      "Swap failed: custom program error: 0x1771"
    );
    expect(describeExecuteError(-1001)).toBe("Swap failed (unknown error)");
    expect(describeExecuteError(-42, "Weird")).toBe("Weird");
    expect(describeExecuteError(undefined)).toBe("Swap failed");
    expect(describeExecuteError(-1001, "Slippage tolerance exceeded")).toMatch(/slippage/i);
  });
});

describe("isUnknownExecuteOutcome", () => {
  it("covers the local sentinel and Jupiter's unknown codes only", () => {
    expect(isUnknownExecuteOutcome(EXECUTE_UNKNOWN_STATUS_CODE)).toBe(true);
    expect(isUnknownExecuteOutcome(-1001)).toBe(true);
    expect(isUnknownExecuteOutcome(-2001)).toBe(true);
    for (const c of [0, -1, -2, -1000, -1004, -2000, -2003, -2004]) {
      expect(isUnknownExecuteOutcome(c)).toBe(false);
    }
    expect(isUnknownExecuteOutcome(undefined)).toBe(false);
    expect(isUnknownExecuteOutcome(null)).toBe(false);
  });
});

describe("isUserRejection", () => {
  it("detects wallet rejections", () => {
    const err = Object.assign(new Error("User rejected the request."), {
      name: "WalletSignTransactionError",
    });
    expect(isUserRejection(err)).toBe(true);
    expect(isUserRejection({ code: 4001, message: "x" })).toBe(true);
    expect(isUserRejection({ message: "wrapped", error: { code: 4001 } })).toBe(true);
    expect(isUserRejection(new Error("Transaction declined"))).toBe(true);
  });

  it("ignores other errors", () => {
    expect(isUserRejection(new Error("Network request failed"))).toBe(false);
    expect(isUserRejection(null)).toBe(false);
    expect(isUserRejection("rejected")).toBe(false);
  });
});
