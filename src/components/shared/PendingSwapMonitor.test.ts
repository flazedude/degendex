import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Connection, RpcResponseAndContext, SignatureStatus } from "@solana/web3.js";
import { toast } from "sonner";
import { usePendingSwapStore, type PendingSwap } from "@/store/usePendingSwapStore";
import { recordConfirmedSwap } from "@/store/useSwapReceipts";
import { monitorPendingSwap } from "./PendingSwapMonitor";

vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }),
}));
vi.mock("@/store/useSwapReceipts", () => ({ recordConfirmedSwap: vi.fn() }));

const NOW = 1_700_000_000_000;
const tokens = {
  input: { mint: "So11111111111111111111111111111111111111112", symbol: "SOL", decimals: 9 },
  output: { mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", symbol: "USDC", decimals: 6 },
};
const signature = "A".repeat(88);

function pending(overrides: Partial<PendingSwap> = {}): PendingSwap {
  return {
    wallet: "wallet-a",
    signature,
    tokens,
    until: NOW + 90_000,
    toastId: "swap",
    summary: "1 SOL → USDC",
    ...overrides,
  };
}

function lookup(status: SignatureStatus | null): RpcResponseAndContext<(SignatureStatus | null)[]> {
  return { context: { slot: 1 }, value: [status] };
}

function rpc() {
  return {
    getSignatureStatuses: vi.fn<Connection["getSignatureStatuses"]>(),
    getBlockHeight: vi.fn<Connection["getBlockHeight"]>(),
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
  usePendingSwapStore.setState({ pending: {}, inFlight: {} });
});

describe("monitoring a pending swap", () => {
  it("records an independently confirmed wallet without known fill amounts", async () => {
    const record = pending();
    const other = pending({ wallet: "wallet-b", signature: "B".repeat(88) });
    const connection = rpc();
    connection.getSignatureStatuses
      .mockResolvedValueOnce(lookup({ slot: 1, confirmations: 1, err: null, confirmationStatus: "processed" }))
      .mockResolvedValueOnce(lookup({ slot: 1, confirmations: 2, err: null, confirmationStatus: "confirmed" }));
    const refreshBalances = vi.fn();
    usePendingSwapStore.getState().setPending(record);
    usePendingSwapStore.getState().setPending(other);
    monitorPendingSwap(record, connection, refreshBalances);

    await vi.advanceTimersByTimeAsync(2_000);
    expect(recordConfirmedSwap).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(2_000);
    expect(recordConfirmedSwap).toHaveBeenCalledExactlyOnceWith({
      wallet: record.wallet,
      signature,
      ...tokens,
      confirmedAt: NOW + 4_000,
      inputAmountRaw: null,
      outputAmountRaw: null,
    });
    expect(usePendingSwapStore.getState().pending).toEqual({ [other.wallet]: other });
    expect(refreshBalances).toHaveBeenCalledOnce();
  });

  it("does not publish an in-flight result for a replaced pending record", async () => {
    const record = pending();
    const replacement = pending({ signature: "B".repeat(88), until: NOW + 95_000 });
    const connection = rpc();
    let resolve!: (status: RpcResponseAndContext<(SignatureStatus | null)[]>) => void;
    connection.getSignatureStatuses.mockReturnValue(
      new Promise((complete) => { resolve = complete; })
    );
    const refreshBalances = vi.fn();
    usePendingSwapStore.getState().setPending(record);
    monitorPendingSwap(record, connection, refreshBalances);

    await vi.advanceTimersByTimeAsync(2_000);
    expect(connection.getSignatureStatuses).toHaveBeenCalledOnce();
    usePendingSwapStore.getState().setPending(replacement);
    resolve(lookup({ slot: 1, confirmations: null, err: null, confirmationStatus: "finalized" }));
    await vi.advanceTimersByTimeAsync(0);
    expect(recordConfirmedSwap).not.toHaveBeenCalled();
    expect(toast.success).not.toHaveBeenCalled();
    expect(refreshBalances).not.toHaveBeenCalled();
    expect(usePendingSwapStore.getState().pending[record.wallet]).toBe(replacement);
  });

  it("cancels the RPC timeout when the watcher is torn down", async () => {
    const record = pending();
    const connection = rpc();
    connection.getSignatureStatuses.mockReturnValue(new Promise(() => {}));
    usePendingSwapStore.getState().setPending(record);
    const stop = monitorPendingSwap(record, connection, vi.fn());

    await vi.advanceTimersByTimeAsync(2_000);
    expect(connection.getSignatureStatuses).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(1);
    stop();
    await vi.advanceTimersByTimeAsync(0);
    expect(vi.getTimerCount()).toBe(0);
    expect(usePendingSwapStore.getState().pending[record.wallet]).toBe(record);
    expect(recordConfirmedSwap).not.toHaveBeenCalled();
  });

  it("rechecks after block height expiry and omits a dropped swap", async () => {
    const record = pending({ lastValidBlockHeight: 10 });
    const connection = rpc();
    connection.getSignatureStatuses.mockResolvedValue(lookup(null));
    connection.getBlockHeight.mockResolvedValue(11);
    usePendingSwapStore.getState().setPending(record);
    monitorPendingSwap(record, connection, vi.fn());

    await vi.advanceTimersByTimeAsync(2_000);
    expect(usePendingSwapStore.getState().pending[record.wallet]).toBe(record);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(connection.getSignatureStatuses).toHaveBeenCalledTimes(2);
    expect(usePendingSwapStore.getState().pending[record.wallet]).toBeUndefined();
    expect(recordConfirmedSwap).not.toHaveBeenCalled();
  });

  it("keeps a signature-less swap pending unless its wait ends or it is dismissed", async () => {
    const record = pending({ signature: undefined, until: NOW + 3_000 });
    const connection = rpc();
    usePendingSwapStore.getState().setPending(record);
    const stop = monitorPendingSwap(record, connection, vi.fn());
    stop();

    await vi.advanceTimersByTimeAsync(2_000);
    expect(usePendingSwapStore.getState().pending[record.wallet]).toBe(record);

    monitorPendingSwap(record, connection, vi.fn());
    await vi.advanceTimersByTimeAsync(1_000);
    expect(usePendingSwapStore.getState().pending[record.wallet]).toBeUndefined();
    expect(connection.getSignatureStatuses).not.toHaveBeenCalled();
    expect(recordConfirmedSwap).not.toHaveBeenCalled();
  });
});
