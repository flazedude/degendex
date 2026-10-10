import { afterEach, describe, expect, it } from "vitest";
import { isSwapBlocked, usePendingSwapStore, type PendingSwap } from "./usePendingSwapStore";

const record = (over: Partial<PendingSwap> = {}): PendingSwap => ({
  wallet: "A",
  until: 1_000,
  toastId: "t",
  summary: "1 SOL → USDC",
  ...over,
});

afterEach(() => usePendingSwapStore.setState({ pending: null }));

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
