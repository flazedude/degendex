import { useEffect, useState } from "react";
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

/**
 * A swap between "user pressed Swap" and its outcome (quote refresh, wallet
 * signature, /execute). Global rather than per hook instance, so a form that
 * remounts (tab or market change) or another page cannot start a second swap
 * from the same wallet while the first is still running.
 */
export interface SwapInFlight {
  wallet: string;
  /** Epoch ms. */
  startedAt: number;
  inputMint: string;
  outputMint: string;
  inputSymbol: string;
  outputSymbol: string;
}

/**
 * After this long an in-flight record no longer blocks (e.g. a wallet popup
 * that never resolves). Far beyond any order's validity, so the abandoned swap
 * can no longer land by then.
 */
export const SWAP_IN_FLIGHT_MAX_MS = 5 * 60_000;

interface PendingSwapState {
  pending: PendingSwap | null;
  setPending: (pending: PendingSwap) => void;
  /** Clears `pending` only if it is still the current record (or any, if omitted). */
  clearPending: (pending?: PendingSwap) => void;
  /** Running swaps, by wallet (at most one per wallet). */
  inFlight: Readonly<Record<string, SwapInFlight>>;
}

export const usePendingSwapStore = create<PendingSwapState>((set, get) => ({
  pending: null,
  setPending: (pending) => set({ pending }),
  clearPending: (pending) => {
    if (!pending || get().pending === pending) set({ pending: null });
  },
  inFlight: {},
}));

function activeInFlight(
  rec: SwapInFlight | undefined,
  now: number
): SwapInFlight | null {
  return rec && now - rec.startedAt < SWAP_IN_FLIGHT_MAX_MS ? rec : null;
}

/** The swap currently running for `wallet`, if any (lapsed records ignored). */
export function getSwapInFlight(wallet: string, now: number = Date.now()): SwapInFlight | null {
  return activeInFlight(usePendingSwapStore.getState().inFlight[wallet], now);
}

/**
 * Claims the wallet's swap slot. Returns the record to pass to endSwap, or
 * null when another swap from this wallet is still running. Synchronous
 * check-and-set: two presses in the same tick cannot both get a slot.
 */
export function beginSwap(
  swap: Omit<SwapInFlight, "startedAt">,
  now: number = Date.now()
): SwapInFlight | null {
  if (getSwapInFlight(swap.wallet, now)) return null;
  const rec: SwapInFlight = { ...swap, startedAt: now };
  usePendingSwapStore.setState((s) => ({ inFlight: { ...s.inFlight, [swap.wallet]: rec } }));
  return rec;
}

/** Releases the slot, only if it still holds `rec` (a lapsed one may be replaced). */
export function endSwap(rec: SwapInFlight): void {
  usePendingSwapStore.setState((s) => {
    if (s.inFlight[rec.wallet] !== rec) return s;
    const next = { ...s.inFlight };
    delete next[rec.wallet];
    return { inFlight: next };
  });
}

/**
 * React view of getSwapInFlight: re-renders when a swap from `wallet` starts,
 * ends, or its record lapses.
 */
export function useSwapInFlight(wallet: string | null | undefined): SwapInFlight | null {
  const rec = usePendingSwapStore((s) => (wallet ? s.inFlight[wallet] : undefined)) ?? null;
  const [lapsed, setLapsed] = useState<SwapInFlight | null>(null);
  useEffect(() => {
    if (!rec) return;
    const t = setTimeout(
      () => setLapsed(rec),
      Math.max(0, rec.startedAt + SWAP_IN_FLIGHT_MAX_MS - Date.now())
    );
    return () => clearTimeout(t);
  }, [rec]);
  return rec && lapsed !== rec ? rec : null;
}

/** Whether swaps from `wallet` are blocked by an earlier unknown-outcome swap. */
export function isSwapBlocked(wallet: string, now: number = Date.now()): boolean {
  const p = usePendingSwapStore.getState().pending;
  return !!p && p.wallet === wallet && p.until > now;
}
