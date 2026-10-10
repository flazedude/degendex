import { create } from "zustand";

/**
 * A swap whose /execute outcome is unknown: it may still land. Kept outside the
 * swap hook so the block survives a wallet reconnect or leaving /swap.
 */
export interface PendingSwap {
  wallet: string;
  /** Known when the wallet paid the fee (signature computed before /execute). */
  signature?: string;
  lastValidBlockHeight?: number;
  /** Epoch ms after which the block lapses. */
  until: number;
  toastId: string | number;
  summary: string;
}

interface PendingSwapState {
  pending: PendingSwap | null;
  setPending: (pending: PendingSwap) => void;
  /** Clears `pending` only if it is still the current record (or any, if omitted). */
  clearPending: (pending?: PendingSwap) => void;
}

export const usePendingSwapStore = create<PendingSwapState>((set, get) => ({
  pending: null,
  setPending: (pending) => set({ pending }),
  clearPending: (pending) => {
    if (!pending || get().pending === pending) set({ pending: null });
  },
}));

/** Whether swaps from `wallet` are blocked by an earlier unknown-outcome swap. */
export function isSwapBlocked(wallet: string, now: number = Date.now()): boolean {
  const p = usePendingSwapStore.getState().pending;
  return !!p && p.wallet === wallet && p.until > now;
}
