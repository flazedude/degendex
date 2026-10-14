import { afterEach, describe, expect, it, vi } from "vitest";
import type { TriggerOrderRow } from "@/lib/jupiter/trigger/types";
import {
  STOPPED_ROW_TTL_MS,
  UNKNOWN_OUTCOME_HOLD_MS,
  acquireTriggerBusy,
  busyReason,
  clearStoppedOrder,
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
