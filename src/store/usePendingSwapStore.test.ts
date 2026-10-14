import { afterEach, describe, expect, it } from "vitest";
import {
  SWAP_IN_FLIGHT_MAX_MS,
  beginSwap,
  endSwap,
  getSwapInFlight,
  isSwapBlocked,
  usePendingSwapStore,
  type PendingSwap,
} from "./usePendingSwapStore";

const record = (over: Partial<PendingSwap> = {}): PendingSwap => ({
  wallet: "A",
  until: 1_000,
  toastId: "t",
  summary: "1 SOL → USDC",
  ...over,
});

afterEach(() => usePendingSwapStore.setState({ pending: null, inFlight: {} }));

describe("usePendingSwapStore", () => {
  it("blocks only the wallet that swapped, until the record lapses", () => {
    usePendingSwapStore.getState().setPending(record());
    expect(isSwapBlocked("A", 999)).toBe(true);
    expect(isSwapBlocked("B", 999)).toBe(false);
    expect(isSwapBlocked("A", 1_000)).toBe(false);
  });

  it("only clears the record it was given", () => {
    const first = record();
    const second = record({ until: 2_000 });
    usePendingSwapStore.getState().setPending(first);
    usePendingSwapStore.getState().setPending(second);
    usePendingSwapStore.getState().clearPending(first);
    expect(usePendingSwapStore.getState().pending).toBe(second);
    usePendingSwapStore.getState().clearPending();
    expect(usePendingSwapStore.getState().pending).toBeNull();
  });
});

describe("swap in-flight lock", () => {
  const swap = (wallet = "A") => ({
    wallet,
    inputMint: "USDC",
    outputMint: "BONK",
    inputSymbol: "USDC",
    outputSymbol: "BONK",
  });

  it("allows one running swap per wallet", () => {
    const first = beginSwap(swap(), 1_000);
    expect(first).not.toBeNull();
    expect(getSwapInFlight("A", 1_001)).toBe(first);
    // A second press (e.g. from a remounted form) is refused.
    expect(beginSwap(swap(), 1_002)).toBeNull();
    // Other wallets are independent.
    expect(beginSwap(swap("B"), 1_002)).not.toBeNull();
    expect(getSwapInFlight("A", 1_003)).toBe(first);
  });

  it("frees the slot when the swap ends", () => {
    const first = beginSwap(swap(), 1_000)!;
    endSwap(first);
    expect(getSwapInFlight("A", 1_001)).toBeNull();
    expect(beginSwap(swap(), 1_002)).not.toBeNull();
  });

  it("lapses after the max age, and the old swap cannot clear its replacement", () => {
    const stuck = beginSwap(swap(), 0)!;
    expect(getSwapInFlight("A", SWAP_IN_FLIGHT_MAX_MS - 1)).toBe(stuck);
    expect(getSwapInFlight("A", SWAP_IN_FLIGHT_MAX_MS)).toBeNull();
    const next = beginSwap(swap(), SWAP_IN_FLIGHT_MAX_MS)!;
    expect(next).not.toBeNull();
    endSwap(stuck); // the abandoned swap finally settles
    expect(getSwapInFlight("A", SWAP_IN_FLIGHT_MAX_MS + 1)).toBe(next);
  });

  it("is independent of the unknown-outcome block", () => {
    beginSwap(swap(), 1_000);
    expect(isSwapBlocked("A", 1_001)).toBe(false);
    expect(usePendingSwapStore.getState().pending).toBeNull();
  });
});
