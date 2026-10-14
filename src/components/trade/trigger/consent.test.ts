import { beforeEach, describe, expect, it } from "vitest";
import { consentKey, hasConsent, recordConsent, resetConsentMemory } from "./consent";

const W = "7GCihgDB8fe6KNjn2MYtkzZcRjQy3t9GHdC8uHYmW2hr";

function memStorage() {
  const m = new Map<string, string>();
  return {
    m,
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
  };
}

const throwing = {
  getItem: () => {
    throw new Error("SecurityError");
  },
  setItem: () => {
    throw new Error("QuotaExceededError");
  },
};

describe("trigger consent storage", () => {
  beforeEach(() => resetConsentMemory());

  it("uses a versioned per-wallet key", () => {
    expect(consentKey(W)).toBe(`degn.trigger.consent.v1.${W}`);
  });

  it("is false until recorded, then true", () => {
    const s = memStorage();
    expect(hasConsent(W, s)).toBe(false);
    recordConsent(W, 123, s);
    expect(s.m.get(consentKey(W))).toBe("123");
    resetConsentMemory();
    expect(hasConsent(W, s)).toBe(true);
    expect(hasConsent("other", s)).toBe(false);
  });

  it("is false without a wallet", () => {
    expect(hasConsent(null, memStorage())).toBe(false);
  });

  it("survives blocked storage for the page view and never throws", () => {
    expect(hasConsent(W, throwing)).toBe(false);
    expect(() => recordConsent(W, 1, throwing)).not.toThrow();
    expect(hasConsent(W, throwing)).toBe(true);
    expect(hasConsent(W, null)).toBe(true);
  });
});
