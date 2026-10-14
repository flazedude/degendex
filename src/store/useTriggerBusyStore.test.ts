import { afterEach, describe, expect, it, vi } from "vitest";
import { liveStoppedRows } from "@/lib/jupiter/trigger/normalize";
import type { TriggerOrderRow } from "@/lib/jupiter/trigger/types";
import {
  STOPPED_ROW_TTL_MS,
  TRIGGER_BUSY_MAX_MS,
  UNKNOWN_OUTCOME_HOLD_MS,
  acquireTriggerBusy,
  busyReason,
  clearSettledStoppedOrders,
  clearStoppedOrder,
  getActiveTriggerPending,
  holdNewOrders,
  isNewOrderHeld,
  markOrderStopped,
  recentStoppedRows,
  releaseTriggerBusy,
  resetTriggerBusyStore,
  useTriggerBusyStore,
} from "./useTriggerBusyStore";

const W = "BQ72nSv9f3PRyRKCBnHLVrerrv37CYTHm5h3s9VSGQDV";
const NOW = 1_800_000_000_000;

const row = (id: string, family: TriggerOrderRow["family"] = "price") =>
  ({ id, family, status: "open", canCancel: true, canWithdraw: false }) as TriggerOrderRow;

afterEach(() => {
  resetTriggerBusyStore();
  vi.useRealTimers();
});

describe("shared busy lock", () => {
  it("lets only one action run at a time, across callers", () => {
    const a = acquireTriggerBusy({ kind: "limit" });
    expect(a).not.toBeNull();
    // A second hook instance (e.g. Open orders) sees the same lock.
    expect(acquireTriggerBusy({ kind: "cancel", orderId: "x" })).toBeNull();
    expect(useTriggerBusyStore.getState().pending).toEqual({ kind: "limit" });
    expect(busyReason(useTriggerBusyStore.getState().pending)).toBe("Finish the limit order first");
    releaseTriggerBusy(a!);
    expect(useTriggerBusyStore.getState().pending).toBeNull();
    expect(acquireTriggerBusy({ kind: "cancel", orderId: "x" })).not.toBeNull();
  });

  it("a stale token cannot release someone else's lock", () => {
    const a = acquireTriggerBusy({ kind: "dca" })!;
    releaseTriggerBusy(a);
    const b = acquireTriggerBusy({ kind: "withdraw", orderId: "y" })!;
    releaseTriggerBusy(a);
    expect(useTriggerBusyStore.getState().pending).toEqual({ kind: "withdraw", orderId: "y" });
    releaseTriggerBusy(b);
    expect(useTriggerBusyStore.getState().pending).toBeNull();
  });

  it("names every reason", () => {
    expect(busyReason(null)).toBeNull();
    expect(busyReason({ kind: "dca" })).toMatch(/DCA/);
    expect(busyReason({ kind: "cancel", orderId: "1" })).toMatch(/cancel/);
    expect(busyReason({ kind: "withdraw", orderId: "1" })).toMatch(/withdrawal/);
  });
});

describe("lock lapse", () => {
  it("treats a lock older than 4 minutes as free", () => {
    expect(TRIGGER_BUSY_MAX_MS).toBe(4 * 60_000);
    const a = acquireTriggerBusy({ kind: "withdraw", orderId: "x" }, NOW)!;
    expect(a).not.toBeNull();
    expect(useTriggerBusyStore.getState().acquiredAt).toBe(NOW);
    expect(getActiveTriggerPending(NOW + TRIGGER_BUSY_MAX_MS - 1)).toEqual({ kind: "withdraw", orderId: "x" });
    expect(acquireTriggerBusy({ kind: "limit" }, NOW + TRIGGER_BUSY_MAX_MS - 1)).toBeNull();
    // Lapsed: no longer reported as busy, and a new flow may take the lock.
    expect(getActiveTriggerPending(NOW + TRIGGER_BUSY_MAX_MS)).toBeNull();
    expect(busyReason(getActiveTriggerPending(NOW + TRIGGER_BUSY_MAX_MS))).toBeNull();
    const b = acquireTriggerBusy({ kind: "limit" }, NOW + TRIGGER_BUSY_MAX_MS);
    expect(b).not.toBeNull();
    expect(b).not.toBe(a);
    // The stale flow's late finally cannot release the newer lock.
    releaseTriggerBusy(a);
    expect(useTriggerBusyStore.getState().pending).toEqual({ kind: "limit" });
    expect(getActiveTriggerPending(NOW + TRIGGER_BUSY_MAX_MS + 1)).toEqual({ kind: "limit" });
    releaseTriggerBusy(b!);
    expect(useTriggerBusyStore.getState()).toMatchObject({ pending: null, token: 0, acquiredAt: 0 });
  });

  it("uses the clock by default", () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    acquireTriggerBusy({ kind: "dca" });
    expect(getActiveTriggerPending()).toEqual({ kind: "dca" });
    vi.setSystemTime(NOW + TRIGGER_BUSY_MAX_MS);
    expect(getActiveTriggerPending()).toBeNull();
    expect(acquireTriggerBusy({ kind: "cancel", orderId: "c" })).not.toBeNull();
  });
});

describe("hold after an unknown outcome", () => {
  it("refuses new orders for the hold and then clears itself", () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    holdNewOrders();
    expect(isNewOrderHeld()).toBe(true);
    expect(useTriggerBusyStore.getState().holdUntil).toBe(NOW + UNKNOWN_OUTCOME_HOLD_MS);
    vi.advanceTimersByTime(UNKNOWN_OUTCOME_HOLD_MS);
    expect(isNewOrderHeld()).toBe(false);
    expect(useTriggerBusyStore.getState().holdUntil).toBe(0);
  });
});

describe("stopped orders", () => {
  it("remembers per wallet, expires after the TTL and can be cleared", () => {
    markOrderStopped(W, row("a"), NOW);
    markOrderStopped("other", row("b"), NOW);
    const stopped = useTriggerBusyStore.getState().stopped;
    expect(recentStoppedRows(stopped, W, NOW + 1).map((r) => r.id)).toEqual(["a"]);
    expect(recentStoppedRows(stopped, null, NOW)).toEqual([]);
    expect(recentStoppedRows(stopped, W, NOW + STOPPED_ROW_TTL_MS)).toEqual([]);
    clearStoppedOrder(W, row("a"));
    expect(recentStoppedRows(useTriggerBusyStore.getState().stopped, W, NOW + 1)).toEqual([]);
  });

  it("drops expired entries when a new one is added", () => {
    markOrderStopped(W, row("old"), NOW);
    markOrderStopped(W, row("new", "dca"), NOW + STOPPED_ROW_TTL_MS + 1);
    expect(Object.keys(useTriggerBusyStore.getState().stopped)).toEqual([`${W}:dca:new`]);
  });
});

describe("stopped rows do not come back", () => {
  /** What useTriggerOrders does per render: derive, then reconcile the store. */
  function render(server: TriggerOrderRow[], nowMs: number): TriggerOrderRow[] {
    const live = liveStoppedRows(server, recentStoppedRows(useTriggerBusyStore.getState().stopped, W, nowMs));
    clearSettledStoppedOrders(W, server);
    return live;
  }
  const dcaRow = (status: TriggerOrderRow["status"], canWithdraw: boolean) =>
    ({ ...row("d1", "dca"), status, state: status, canCancel: false, canWithdraw }) as TriggerOrderRow;

  it("stopped -> Jupiter shows withdrawing -> Jupiter no longer lists it: stays gone", () => {
    markOrderStopped(W, row("d1", "dca"), NOW);
    // Jupiter still shows the order active: our stopped copy is shown.
    expect(render([{ ...row("d1", "dca"), canCancel: true }], NOW + 1).map((r) => r.status)).toEqual(["withdrawing"]);
    // Jupiter catches up (withdrawing, withdrawable): its copy is the truth and
    // the local record is forgotten.
    expect(render([dcaRow("withdrawing", true)], NOW + 2)).toEqual([]);
    expect(useTriggerBusyStore.getState().stopped).toEqual({});
    // Withdrawn elsewhere: gone from the active lists, and not resurrected.
    expect(render([], NOW + 3)).toEqual([]);
  });

  it("also forgets orders Jupiter reports as finished", () => {
    markOrderStopped(W, row("p1"), NOW);
    markOrderStopped("other-wallet", row("p1"), NOW);
    render([{ ...row("p1"), status: "cancelled", canCancel: false }], NOW + 1);
    expect(recentStoppedRows(useTriggerBusyStore.getState().stopped, W, NOW + 2)).toEqual([]);
    expect(render([], NOW + 2)).toEqual([]);
    // Another wallet's record is untouched.
    expect(recentStoppedRows(useTriggerBusyStore.getState().stopped, "other-wallet", NOW + 2)).toHaveLength(1);
  });

  it("keeps the record while Jupiter has not caught up", () => {
    markOrderStopped(W, row("p2"), NOW);
    expect(render([row("p2")], NOW + 1)).toHaveLength(1);
    expect(render([], NOW + 2)).toHaveLength(1);
    expect(Object.keys(useTriggerBusyStore.getState().stopped)).toEqual([`${W}:price:p2`]);
  });
});
