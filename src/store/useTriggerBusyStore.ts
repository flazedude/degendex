import { useEffect, useState } from "react";
import { create } from "zustand";
import { settledStoppedRows } from "@/lib/jupiter/trigger/normalize";
import type { TriggerOrderRow } from "@/lib/jupiter/trigger/types";

// Shared, in-memory state for Trigger actions (limit / DCA / cancel /
// withdraw). Every useTriggerActions() instance reads the same store, so a
// second order or a cancel cannot start while another flow (and its wallet
// prompt) is still running, whichever component started it.

export type TriggerPendingAction =
  | { kind: "limit" }
  | { kind: "dca" }
  | { kind: "cancel"; orderId: string }
  | { kind: "withdraw"; orderId: string };

/** No new order after an unknown create outcome, until this has passed. */
export const UNKNOWN_OUTCOME_HOLD_MS = 60_000;
/**
 * A lock older than this no longer blocks (e.g. a wallet popup that never
 * resolves, or a flow whose finally never ran), so the UI cannot stay stuck.
 */
export const TRIGGER_BUSY_MAX_MS = 4 * 60_000;
/** A locally stopped order is shown as "needs withdraw" at most this long. */
export const STOPPED_ROW_TTL_MS = 15 * 60_000;

export interface StoppedOrder {
  row: TriggerOrderRow;
  /** Wallet that owns the order. */
  wallet: string;
  at: number;
}

interface TriggerBusyState {
  pending: TriggerPendingAction | null;
  /** Identifies the flow holding the lock, so only it can release it. */
  token: number;
  /** Epoch ms when `pending` was taken (0 when free). */
  acquiredAt: number;
  /** Epoch ms until which new orders are refused (unknown outcome), 0 = none. */
  holdUntil: number;
  /**
   * Orders whose cancel step went through but whose withdrawal did not, keyed
   * by wallet:family:id. Shown with a Withdraw button until Jupiter's own lists catch
   * up (see liveStoppedRows).
   */
  stopped: Record<string, StoppedOrder>;
}

export const useTriggerBusyStore = create<TriggerBusyState>()(() => ({
  pending: null,
  token: 0,
  acquiredAt: 0,
  holdUntil: 0,
  stopped: {},
}));

let nextToken = 1;
let holdTimer: ReturnType<typeof setTimeout> | null = null;

function activePending(
  s: Pick<TriggerBusyState, "pending" | "acquiredAt">,
  nowMs: number
): TriggerPendingAction | null {
  return s.pending && nowMs - s.acquiredAt < TRIGGER_BUSY_MAX_MS ? s.pending : null;
}

/** The action holding the lock, or null when free or lapsed (TRIGGER_BUSY_MAX_MS). */
export function getActiveTriggerPending(nowMs: number = Date.now()): TriggerPendingAction | null {
  return activePending(useTriggerBusyStore.getState(), nowMs);
}

/**
 * Takes the shared lock for `action`. Returns a token for releaseTriggerBusy,
 * or null when another action holds it. Check-and-set is synchronous, so two
 * clicks in the same tick cannot both get it. A lapsed lock counts as free.
 */
export function acquireTriggerBusy(action: TriggerPendingAction, nowMs: number = Date.now()): number | null {
  if (getActiveTriggerPending(nowMs)) return null;
  const token = nextToken++;
  useTriggerBusyStore.setState({ pending: action, token, acquiredAt: nowMs });
  return token;
}

/**
 * Releases the lock if `token` still holds it: the late finally of a lapsed
 * flow cannot release a newer flow's lock.
 */
export function releaseTriggerBusy(token: number): void {
  if (useTriggerBusyStore.getState().token !== token) return;
  useTriggerBusyStore.setState({ pending: null, token: 0, acquiredAt: 0 });
}

/**
 * React view of getActiveTriggerPending: re-renders when the lock is taken,
 * released, or lapses.
 */
export function useActiveTriggerPending(): TriggerPendingAction | null {
  const pending = useTriggerBusyStore((s) => s.pending);
  const acquiredAt = useTriggerBusyStore((s) => s.acquiredAt);
  const [lapsedAt, setLapsedAt] = useState(0);
  useEffect(() => {
    if (!pending) return;
    const t = setTimeout(
      () => setLapsedAt(acquiredAt),
      Math.max(0, acquiredAt + TRIGGER_BUSY_MAX_MS - Date.now())
    );
    return () => clearTimeout(t);
  }, [pending, acquiredAt]);
  return pending && lapsedAt !== acquiredAt ? pending : null;
}

/** Short, user-facing reason why another action cannot start now. */
export function busyReason(pending: TriggerPendingAction | null): string | null {
  switch (pending?.kind) {
    case "limit":
      return "Finish the limit order first";
    case "dca":
      return "Finish the DCA order first";
    case "cancel":
      return "Finish the cancel first";
    case "withdraw":
      return "Finish the withdrawal first";
    default:
      return null;
  }
}

/** Refuses new orders for `ms` (after an order whose outcome is unknown). */
export function holdNewOrders(ms: number = UNKNOWN_OUTCOME_HOLD_MS, nowMs: number = Date.now()): void {
  useTriggerBusyStore.setState({ holdUntil: nowMs + ms });
  if (holdTimer) clearTimeout(holdTimer);
  holdTimer = setTimeout(() => {
    holdTimer = null;
    useTriggerBusyStore.setState({ holdUntil: 0 });
  }, ms);
}

export function isNewOrderHeld(nowMs: number = Date.now()): boolean {
  return useTriggerBusyStore.getState().holdUntil > nowMs;
}

const keyOf = (wallet: string, row: Pick<TriggerOrderRow, "family" | "id">) =>
  `${wallet}:${row.family}:${row.id}`;

/** Remembers that `row` was stopped (cancel step done) but not withdrawn. */
export function markOrderStopped(wallet: string, row: TriggerOrderRow, nowMs: number = Date.now()): void {
  useTriggerBusyStore.setState((s) => {
    const stopped: Record<string, StoppedOrder> = {};
    // Drop expired entries while we are at it.
    for (const [k, v] of Object.entries(s.stopped)) if (nowMs - v.at < STOPPED_ROW_TTL_MS) stopped[k] = v;
    stopped[keyOf(wallet, row)] = { row, wallet, at: nowMs };
    return { stopped };
  });
}

export function clearStoppedOrder(wallet: string, row: Pick<TriggerOrderRow, "family" | "id">): void {
  const key = keyOf(wallet, row);
  if (!useTriggerBusyStore.getState().stopped[key]) return;
  useTriggerBusyStore.setState((s) => {
    const next = { ...s.stopped };
    delete next[key];
    return { stopped: next };
  });
}

/**
 * Forgets `wallet`'s stopped orders that Jupiter's lists (`server`) now report
 * as withdrawable or finished. From then on Jupiter's copy is the truth, so a
 * later disappearance from the lists (withdrawn elsewhere) cannot bring the
 * stopped row back.
 */
export function clearSettledStoppedOrders(wallet: string, server: readonly TriggerOrderRow[]): void {
  const mine = Object.values(useTriggerBusyStore.getState().stopped)
    .filter((s) => s.wallet === wallet)
    .map((s) => s.row);
  if (mine.length === 0) return;
  for (const row of settledStoppedRows(server, mine)) clearStoppedOrder(wallet, row);
}

/** `wallet`'s stopped orders recorded within the TTL. */
export function recentStoppedRows(
  stopped: Record<string, StoppedOrder>,
  wallet: string | null,
  nowMs: number = Date.now()
): TriggerOrderRow[] {
  if (!wallet) return [];
  return Object.values(stopped)
    .filter((s) => s.wallet === wallet && nowMs - s.at < STOPPED_ROW_TTL_MS)
    .map((s) => s.row);
}

/** Test helper: back to the initial state. */
export function resetTriggerBusyStore(): void {
  if (holdTimer) clearTimeout(holdTimer);
  holdTimer = null;
  useTriggerBusyStore.setState({ pending: null, token: 0, acquiredAt: 0, holdUntil: 0, stopped: {} });
}
