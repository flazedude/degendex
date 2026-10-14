import { describe, expect, it } from "vitest";
import { swapButtonState, type SwapButtonInput } from "./swapButtonState";

/** Everything ready to swap; each test breaks one thing. */
const READY: SwapButtonInput = {
  connected: true,
  swapping: false,
  pendingSwap: null,
  rawAmount: "1000000",
  insufficient: false,
  inputSymbol: "USDC",
  isQuoting: false,
  quoteError: null,
  orderError: null,
  order: { transaction: "AQID" },
  severity: "low",
  priceImpactPct: 0.1,
  armed: false,
};

const state = (patch: Partial<SwapButtonInput> = {}) => swapButtonState({ ...READY, ...patch });

describe("swapButtonState", () => {
  it("swap when everything is ready", () => {
    expect(state()).toEqual({ kind: "swap", label: "Swap", tone: "primary", action: "swap" });
    expect(state({ severity: "medium", priceImpactPct: 2 }).kind).toBe("swap");
  });

  it("connect wallet", () => {
    expect(state({ connected: false })).toEqual({
      kind: "connect",
      label: "Connect Wallet",
      tone: "connect",
      action: "connect",
    });
  });

  it("swapping spins and is disabled", () => {
    expect(state({ swapping: true })).toEqual({
      kind: "swapping",
      label: "Swapping...",
      tone: "primary",
      action: null,
      spin: true,
    });
    expect(state({ swapping: true, swappingLabel: "Buying..." }).label).toBe("Buying...");
  });

  it("pending previous swap blocks; spins only when it cannot be dismissed", () => {
    const watching = state({ pendingSwap: { canDismiss: false } });
    expect(watching).toMatchObject({ kind: "pending", action: null, tone: "muted", spin: true });
    expect(watching.label).toBe("Previous swap may still land - check wallet");
    expect(state({ pendingSwap: { canDismiss: true } })).toMatchObject({
      kind: "pending",
      action: null,
      spin: false,
    });
  });

  it("enter an amount", () => {
    expect(state({ rawAmount: null })).toEqual({
      kind: "enter-amount",
      label: "Enter an amount",
      tone: "muted",
      action: null,
    });
  });

  it("insufficient balance names the input token", () => {
    expect(state({ insufficient: true, inputSymbol: "SOL" })).toEqual({
      kind: "insufficient",
      label: "Insufficient SOL balance",
      tone: "muted",
      action: null,
    });
  });

  it("fetching quote", () => {
    expect(state({ isQuoting: true, order: null })).toEqual({
      kind: "fetching",
      label: "Fetching quote...",
      tone: "muted",
      action: null,
      spin: true,
    });
  });

  it("quote and order errors show their message", () => {
    expect(state({ quoteError: "No route found", order: null })).toEqual({
      kind: "quote-error",
      label: "No route found",
      tone: "muted",
      action: null,
    });
    expect(state({ orderError: "Insufficient funds", order: { transaction: "" } })).toEqual({
      kind: "order-error",
      label: "Insufficient funds",
      tone: "muted",
      action: null,
    });
  });

  it("no route without an order", () => {
    expect(state({ order: null })).toMatchObject({ kind: "no-route", label: "No route found", action: null });
  });

  it("unavailable when the order has no transaction", () => {
    expect(state({ order: { transaction: null } })).toMatchObject({
      kind: "unavailable",
      label: "Quote unavailable, retrying",
      action: null,
    });
    expect(state({ order: { transaction: "" } }).kind).toBe("unavailable");
  });

  it("extreme impact needs a two-step confirm", () => {
    const extreme = { severity: "extreme" as const, priceImpactPct: 23.456 };
    expect(state(extreme)).toEqual({
      kind: "confirm-extreme",
      label: "Swap anyway (price impact 23.46%)",
      tone: "danger",
      action: "confirm-extreme",
    });
    expect(state({ ...extreme, armed: true }).label).toBe("Click again to confirm (impact 23.46%)");
    expect(state({ ...extreme, actionLabel: "Buy BONK", compact: true }).label).toBe(
      "Buy BONK anyway (impact 23.46%)"
    );
  });

  it("high impact is labelled but still swaps", () => {
    expect(state({ severity: "high", priceImpactPct: 7 })).toEqual({
      kind: "high-impact",
      label: "Swap (price impact 7.00%)",
      tone: "primary",
      action: "swap",
    });
    expect(state({ severity: "high", priceImpactPct: 7, actionLabel: "Sell SOL", compact: true }).label).toBe(
      "Sell SOL (impact 7.00%)"
    );
  });

  it("custom action label on the plain swap", () => {
    expect(state({ actionLabel: "Buy SOL" }).label).toBe("Buy SOL");
  });

  describe("priority", () => {
    const everythingWrong: Partial<SwapButtonInput> = {
      swapping: true,
      pendingSwap: { canDismiss: false },
      rawAmount: null,
      insufficient: true,
      isQuoting: true,
      quoteError: "Rate limited, retrying shortly",
      orderError: "Order failed",
      order: null,
      severity: "extreme",
    };

    it("follows connect > swapping > pending > amount > balance > fetching > errors > route", () => {
      const order: [keyof SwapButtonInput, unknown, string][] = [
        ["connected", true, "swapping"],
        ["swapping", false, "pending"],
        ["pendingSwap", null, "enter-amount"],
        ["rawAmount", "5", "insufficient"],
        ["insufficient", false, "fetching"],
        ["isQuoting", false, "quote-error"],
        ["quoteError", null, "order-error"],
        ["orderError", null, "no-route"],
        ["order", { transaction: null }, "unavailable"],
        ["order", { transaction: "AQID" }, "confirm-extreme"],
        ["severity", "high", "high-impact"],
        ["severity", "low", "swap"],
      ];
      let input: SwapButtonInput = { ...READY, ...everythingWrong, connected: false };
      expect(swapButtonState(input).kind).toBe("connect");
      for (const [key, value, expected] of order) {
        input = { ...input, [key]: value };
        expect(swapButtonState(input).kind, `after fixing ${String(key)}`).toBe(expected);
      }
    });

    it("an unconnected wallet always shows connect", () => {
      expect(state({ ...everythingWrong, connected: false }).kind).toBe("connect");
    });

    it("errors win over the impact labels", () => {
      expect(state({ severity: "extreme", quoteError: "Network error, retrying" }).kind).toBe("quote-error");
      expect(state({ severity: "high", orderError: "Order failed" }).kind).toBe("order-error");
    });
  });
});
