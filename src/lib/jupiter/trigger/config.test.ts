import { describe, expect, it } from "vitest";
import {
  JUPITER_FEES_URL,
  NEW_ORDER_ROUTES,
  TRIGGER_FEES_TEXT,
  TRIGGER_OFF_MESSAGE,
  isTriggerRouteAllowed,
  parseTriggerMode,
  triggerModeFromEnv,
} from "./config";

describe("kill switch", () => {
  it("parses NEXT_PUBLIC_DISABLE_TRIGGER", () => {
    for (const v of [undefined, null, "", "0", "false", " FALSE "]) expect(parseTriggerMode(v)).toBe("on");
    for (const v of ["1", "new", "NEW", "true", "yes"]) expect(parseTriggerMode(v)).toBe("new-orders-off");
    for (const v of ["all", " ALL "]) expect(parseTriggerMode(v)).toBe("off");
  });

  it("reads the flag from the given env at call time", () => {
    expect(triggerModeFromEnv({})).toBe("on");
    expect(triggerModeFromEnv({ NEXT_PUBLIC_DISABLE_TRIGGER: "new" })).toBe("new-orders-off");
    expect(triggerModeFromEnv({ NEXT_PUBLIC_DISABLE_TRIGGER: "all" })).toBe("off");
  });

  it("blocks only order-creating routes when new orders are off", () => {
    expect([...NEW_ORDER_ROUTES].sort()).toEqual(["deposit/craft", "orders/dca", "orders/price", "orders/price/:id"]);
    for (const r of NEW_ORDER_ROUTES) {
      expect(isTriggerRouteAllowed("new-orders-off", r)).toBe(false);
      expect(isTriggerRouteAllowed("on", r)).toBe(true);
      expect(isTriggerRouteAllowed("off", r)).toBe(false);
    }
    for (const r of [
      "auth/challenge",
      "auth/verify",
      "auth/refresh",
      "auth/logout",
      "vault",
      "vault/register",
      "orders/history",
      "orders/history/dca",
      "orders/price/cancel/:id",
      "orders/price/confirm-cancel/:id",
    ]) {
      expect(isTriggerRouteAllowed("new-orders-off", r)).toBe(true);
      expect(isTriggerRouteAllowed("off", r)).toBe(false);
    }
  });

  it("copy points to jup.ag and quantifies Jupiter's fee", () => {
    expect(TRIGGER_OFF_MESSAGE).toBe(
      "Orders you already placed are still held by Jupiter. You can view, cancel or withdraw them at jup.ag."
    );
    expect(TRIGGER_FEES_TEXT).toMatch(/^No DEGN DEX fee\. .*0\.03-0\.1% plus up to 0\.5% routing/);
    expect(JUPITER_FEES_URL).toMatch(/^https:\/\/docs\.jup\.ag\/.*fees$/);
  });
});
