import { describe, expect, it } from "vitest";
import { createRefreshTokenStorage, REFRESH_TOKEN_KEY_PREFIX } from "@/lib/jupiter/trigger/tokenStorage";
import { EMPTY_TRIGGER_SESSION, getTriggerSession, useTriggerAuthStore } from "./useTriggerAuthStore";

const W = "BQ72nSv9f3PRyRKCBnHLVrerrv37CYTHm5h3s9VSGQDV";

describe("useTriggerAuthStore", () => {
  it("keeps per-wallet sessions and clears them", () => {
    expect(getTriggerSession(W)).toBe(EMPTY_TRIGGER_SESSION);
    useTriggerAuthStore.getState().setSession(W, { accessToken: "a", expiresAt: 1, status: "ready" });
    expect(getTriggerSession(W)).toEqual({ accessToken: "a", expiresAt: 1, status: "ready", error: null });
    useTriggerAuthStore.getState().clearSession(W, "needs-sign-in", "expired");
    expect(getTriggerSession(W)).toEqual({ accessToken: null, expiresAt: null, status: "needs-sign-in", error: "expired" });
  });
});

describe("refresh token storage", () => {
  it("uses the per-wallet sessionStorage key", () => {
    const m = new Map<string, string>();
    const s = createRefreshTokenStorage(() => ({
      getItem: (k) => m.get(k) ?? null,
      setItem: (k, v) => void m.set(k, v),
      removeItem: (k) => void m.delete(k),
    }));
    s.write(W, "rt");
    expect(m.get(`${REFRESH_TOKEN_KEY_PREFIX}${W}`)).toBe("rt");
    expect(REFRESH_TOKEN_KEY_PREFIX).toBe("degn.trigger.rt.");
    expect(s.read(W)).toBe("rt");
    s.clear(W);
    expect(s.read(W)).toBeNull();
  });

  it("never throws when storage is blocked or missing", () => {
    const boom = () => {
      throw new Error("SecurityError");
    };
    const blocked = createRefreshTokenStorage(() => ({ getItem: boom, setItem: boom, removeItem: boom }));
    expect(() => blocked.write(W, "x")).not.toThrow();
    expect(blocked.read(W)).toBeNull();
    expect(() => blocked.clear(W)).not.toThrow();
    const missing = createRefreshTokenStorage(() => null);
    expect(missing.read(W)).toBeNull();
    const throwingGetter = createRefreshTokenStorage(boom);
    expect(throwingGetter.read(W)).toBeNull();
  });
});
