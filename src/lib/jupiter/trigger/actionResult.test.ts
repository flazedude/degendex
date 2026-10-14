import { describe, expect, it } from "vitest";
import { TriggerApiError } from "./client";
import {
  PRICE_DELAYED_MESSAGE,
  UNKNOWN_OUTCOME_MESSAGE,
  UNREADABLE_WITHDRAWAL_MESSAGE,
  disabledReason,
  isUnknownOutcome,
  toFailure,
  withdrawalCheckFailedMessage,
} from "./actionResult";

const apiErr = (status: number, opts: ConstructorParameters<typeof TriggerApiError>[2] = {}) =>
  new TriggerApiError(`Request failed (${status})`, status, opts);

describe("isUnknownOutcome / toFailure", () => {
  it("treats any 5xx, non-JSON, network or timeout at the landing call as unknown", () => {
    for (const err of [
      apiErr(502),
      apiErr(504),
      apiErr(500),
      apiErr(200, { nonJson: true, code: "bad_response" }),
      apiErr(0, { code: "network" }),
      apiErr(0, { code: "timeout" }),
      apiErr(400, { nonJson: true }),
    ]) {
      expect(isUnknownOutcome(err, "submit")).toBe(true);
      expect(toFailure(err, "submit")).toEqual({ ok: false, code: "unknown_outcome", error: UNKNOWN_OUTCOME_MESSAGE });
    }
  });

  it("the message never suggests retrying", () => {
    expect(UNKNOWN_OUTCOME_MESSAGE).toBe("Status unknown - check Open orders in a minute");
    expect(UNKNOWN_OUTCOME_MESSAGE).not.toMatch(/try again|retry/i);
  });

  it("keeps definite failures as failed", () => {
    expect(toFailure(apiErr(400), "submit")).toMatchObject({ code: "failed" });
    expect(toFailure(apiErr(502), "prepare")).toMatchObject({ code: "failed" });
    expect(toFailure(apiErr(0, { code: "network" }), "prepare")).toMatchObject({ code: "failed" });
  });

  it("the proxy's own unknownOutcome flag wins at any stage", () => {
    expect(toFailure(apiErr(504, { unknownOutcome: true }), "prepare")).toMatchObject({ code: "unknown_outcome" });
  });

  it("auth and rate limits stay what they are", () => {
    expect(toFailure(apiErr(401, { code: "auth_required" }), "submit")).toMatchObject({ code: "auth" });
    expect(toFailure(apiErr(401, { authError: true }), "submit")).toMatchObject({ code: "auth" });
    expect(toFailure(apiErr(429, { code: "rate_limited", retryAfterMs: 5000 }), "submit")).toMatchObject({
      code: "rate_limited",
      retryAfterMs: 5000,
    });
  });

  it("maps wallet rejections and plain errors", () => {
    expect(toFailure({ code: 4001, message: "User rejected the request." }, "sign")).toMatchObject({ code: "rejected" });
    expect(toFailure(new Error("boom"), "prepare")).toEqual({ ok: false, code: "failed", error: "boom" });
    expect(toFailure("weird", "prepare")).toMatchObject({ code: "failed" });
  });
});

describe("disabledReason", () => {
  it("follows the kill-switch mode", () => {
    expect(disabledReason("on", "new-order")).toBeNull();
    expect(disabledReason("on", "manage")).toBeNull();
    expect(disabledReason("new-orders-off", "new-order")).toBe("New limit orders and DCA are paused");
    expect(disabledReason("new-orders-off", "manage")).toBeNull();
    expect(disabledReason("off", "manage")).toMatch(/still held by Jupiter.*jup\.ag/);
    expect(disabledReason("off", "new-order")).toMatch(/jup\.ag/);
  });
});

describe("withdrawal fallbacks", () => {
  it("say the order is cancelled, funds wait in the vault, and point to Withdraw and jup.ag", () => {
    const msg = withdrawalCheckFailedMessage("sends tokens to Abc…xyz");
    expect(msg).toMatch(/nothing was signed/);
    expect(msg).toMatch(/order is cancelled/);
    expect(msg).toMatch(/vault/);
    expect(msg).toMatch(/Withdraw/);
    expect(msg).toMatch(/jup\.ag/);
    expect(UNREADABLE_WITHDRAWAL_MESSAGE).toMatch(/jup\.ag/);
    expect(PRICE_DELAYED_MESSAGE).toBe("Price is delayed, try again in a moment");
  });
});
