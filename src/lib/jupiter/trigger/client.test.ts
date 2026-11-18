import { beforeEach, describe, expect, it, vi } from "vitest";
import { EMPTY_TRIGGER_SESSION, type TriggerSession } from "@/store/useTriggerAuthStore";
import { createTriggerClient, parseAuthTokens, TriggerApiError } from "./client";
import { createRefreshTokenStorage } from "./tokenStorage";

const W = "BQ72nSv9f3PRyRKCBnHLVrerrv37CYTHm5h3s9VSGQDV";
const NOW = 1_800_000_000_000;

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

const tokens = (n: number) => ({
  authMode: "access_refresh",
  accessToken: `access-${n}`,
  refreshToken: `refresh-${n}`,
  expiresAt: new Date(NOW + 15 * 60_000).toISOString(),
  tokenType: "Bearer",
});

function setup() {
  const store = new Map<string, string>();
  const storage = createRefreshTokenStorage(() => ({
    getItem: (k) => store.get(k) ?? null,
    setItem: (k, v) => void store.set(k, v),
    removeItem: (k) => void store.delete(k),
  }));
  const sessions = new Map<string, TriggerSession>();
  let now = NOW;
  const fetchMock = vi.fn<(url: string, init: RequestInit) => Promise<Response>>();
  const client = createTriggerClient({
    fetch: fetchMock,
    now: () => now,
    storage,
    getSession: (w) => sessions.get(w) ?? EMPTY_TRIGGER_SESSION,
    setSession: (w, patch) => sessions.set(w, { ...(sessions.get(w) ?? EMPTY_TRIGGER_SESSION), ...patch }),
    clearSession: (w, status = "signed-out", error = null) =>
      sessions.set(w, { accessToken: null, expiresAt: null, status, error }),
  });
  return {
    client,
    fetchMock,
    store,
    sessions,
    setNow: (t: number) => {
      now = t;
    },
    signIn: () => client.storeTokens(W, { accessToken: "access-0", refreshToken: "refresh-0", expiresAt: NOW + 15 * 60_000 }),
  };
}

const calls = (m: ReturnType<typeof setup>["fetchMock"]) => m.mock.calls.map(([url]) => url);
const authHeader = (m: ReturnType<typeof setup>["fetchMock"], i: number) =>
  (m.mock.calls[i][1].headers as Record<string, string>).Authorization;

describe("parseAuthTokens", () => {
  it("parses the documented shape and defaults a bad expiry", () => {
    expect(parseAuthTokens(tokens(1), NOW)).toEqual({
      accessToken: "access-1",
      refreshToken: "refresh-1",
      expiresAt: NOW + 15 * 60_000,
    });
    expect(parseAuthTokens({ ...tokens(1), expiresAt: "garbage" }, NOW)!.expiresAt).toBe(NOW + 14 * 60_000);
    expect(parseAuthTokens({ authMode: "access_only", token: "x" }, NOW)).toBeNull();
    expect(parseAuthTokens(null, NOW)).toBeNull();
  });
});

describe("triggerFetch", () => {
  let t: ReturnType<typeof setup>;
  beforeEach(() => {
    t = setup();
  });

  it("calls the proxy with the access token, no cookies", async () => {
    t.signIn();
    t.fetchMock.mockResolvedValueOnce(json({ orders: [] }));
    const body = await t.client.triggerFetch("orders/history", { auth: W, query: { state: "active", limit: 100, mint: undefined } });
    expect(body).toEqual({ orders: [] });
    expect(calls(t.fetchMock)).toEqual(["/api/jupiter/trigger/orders/history?state=active&limit=100"]);
    expect(authHeader(t.fetchMock, 0)).toBe("Bearer access-0");
    expect(t.fetchMock.mock.calls[0][1].credentials).toBe("omit");
    expect(t.fetchMock.mock.calls[0][1].cache).toBe("no-store");
  });

  it("throws auth_required when there is no session", async () => {
    await expect(t.client.triggerFetch("vault", { auth: W })).rejects.toMatchObject({ code: "auth_required", status: 401 });
    expect(t.fetchMock).not.toHaveBeenCalled();
  });

  it("refreshes proactively under 60 s to expiry and rotates the stored token", async () => {
    t.signIn();
    t.setNow(NOW + 15 * 60_000 - 30_000);
    t.fetchMock.mockResolvedValueOnce(json(tokens(1))).mockResolvedValueOnce(json({ ok: 1 }));
    await t.client.triggerFetch("vault", { auth: W });
    expect(calls(t.fetchMock)).toEqual(["/api/jupiter/trigger/auth/refresh", "/api/jupiter/trigger/vault"]);
    expect(JSON.parse(t.fetchMock.mock.calls[0][1].body as string)).toEqual({ refreshToken: "refresh-0" });
    expect(authHeader(t.fetchMock, 0)).toBeUndefined();
    expect(authHeader(t.fetchMock, 1)).toBe("Bearer access-1");
    expect(t.store.get(`degn.trigger.rt.${W}`)).toBe("refresh-1");
  });

  it("restores from a stored refresh token after a reload", async () => {
    t.store.set(`degn.trigger.rt.${W}`, "refresh-0");
    t.fetchMock.mockResolvedValueOnce(json(tokens(1)));
    expect(await t.client.restoreSession(W)).toBe(true);
    expect(t.sessions.get(W)).toMatchObject({ accessToken: "access-1", status: "ready" });
  });

  it("single-flights concurrent refreshes", async () => {
    t.signIn();
    t.setNow(NOW + 15 * 60_000 - 1_000);
    let release!: (r: Response) => void;
    t.fetchMock.mockImplementation((url) => {
      if (url.endsWith("auth/refresh")) return new Promise<Response>((r) => (release = r));
      return Promise.resolve(json({ ok: true }));
    });
    const a = t.client.triggerFetch("vault", { auth: W });
    const b = t.client.triggerFetch("orders/history", { auth: W });
    const c = t.client.restoreSession(W);
    await Promise.resolve();
    release(json(tokens(1)));
    await Promise.all([a, b, c]);
    expect(calls(t.fetchMock).filter((u) => u.endsWith("auth/refresh"))).toHaveLength(1);
  });

  it("on a Trigger 401: one refresh, one retry", async () => {
    t.signIn();
    t.fetchMock
      .mockResolvedValueOnce(json({ error: "Session expired", authError: true }, 401))
      .mockResolvedValueOnce(json(tokens(1)))
      .mockResolvedValueOnce(json({ ok: true }));
    expect(await t.client.triggerFetch("vault", { auth: W })).toEqual({ ok: true });
    expect(calls(t.fetchMock)).toEqual([
      "/api/jupiter/trigger/vault",
      "/api/jupiter/trigger/auth/refresh",
      "/api/jupiter/trigger/vault",
    ]);
    expect(authHeader(t.fetchMock, 2)).toBe("Bearer access-1");
  });

  it("never loops: a second 401 clears the session", async () => {
    t.signIn();
    t.fetchMock
      .mockResolvedValueOnce(json({ error: "Session expired", authError: true }, 401))
      .mockResolvedValueOnce(json(tokens(1)))
      .mockResolvedValueOnce(json({ error: "Session expired", authError: true }, 401));
    await expect(t.client.triggerFetch("vault", { auth: W })).rejects.toMatchObject({ code: "auth_required" });
    expect(t.fetchMock).toHaveBeenCalledTimes(3);
    expect(t.sessions.get(W)!.status).toBe("needs-sign-in");
    expect(t.store.has(`degn.trigger.rt.${W}`)).toBe(false);
  });

  it("a rejected refresh clears tokens and is never retried", async () => {
    t.signIn();
    t.fetchMock
      .mockResolvedValueOnce(json({ error: "Session expired", authError: true }, 401))
      .mockResolvedValueOnce(json({ error: "Sign-in expired", authError: true }, 401));
    await expect(t.client.triggerFetch("vault", { auth: W })).rejects.toMatchObject({ code: "auth_required" });
    expect(t.fetchMock).toHaveBeenCalledTimes(2);
    expect(t.sessions.get(W)).toMatchObject({ status: "needs-sign-in", accessToken: null });
    expect(t.store.size).toBe(0);
    await expect(t.client.triggerFetch("vault", { auth: W })).rejects.toMatchObject({ code: "auth_required" });
    expect(t.fetchMock).toHaveBeenCalledTimes(2);
  });

  it("a transient refresh failure keeps the refresh token", async () => {
    t.signIn();
    t.setNow(NOW + 15 * 60_000 - 1_000);
    t.fetchMock.mockResolvedValueOnce(json({ error: "Jupiter Trigger error (500)" }, 502));
    await expect(t.client.triggerFetch("vault", { auth: W })).rejects.toMatchObject({ status: 502 });
    expect(t.store.get(`degn.trigger.rt.${W}`)).toBe("refresh-0");
  });

  it("a non-auth 401 (no authError flag) does not refresh", async () => {
    t.signIn();
    t.fetchMock.mockResolvedValueOnce(json({ error: "Signature rejected", authError: false }, 401));
    await expect(t.client.triggerFetch("vault", { auth: W })).rejects.toMatchObject({ status: 401, authError: false });
    expect(t.fetchMock).toHaveBeenCalledTimes(1);
  });

  it("429 throws a typed error with retryAfterMs", async () => {
    t.signIn();
    t.fetchMock.mockResolvedValueOnce(json({ error: "Rate limited", retryAfterMs: 7000 }, 429));
    const err = await t.client.triggerFetch("vault", { auth: W }).catch((e) => e);
    expect(err).toBeInstanceOf(TriggerApiError);
    expect(err).toMatchObject({ code: "rate_limited", retryAfterMs: 7000, status: 429 });
  });

  it("surfaces details, unknownOutcome and network errors", async () => {
    t.signIn();
    t.fetchMock.mockResolvedValueOnce(json({ error: "Request validation failed", details: { amount: "bad" } }, 400));
    await expect(t.client.triggerFetch("deposit/craft", { auth: W, method: "POST", body: {} })).rejects.toMatchObject({
      message: "Request validation failed",
      details: { amount: "bad" },
    });
    t.fetchMock.mockResolvedValueOnce(json({ error: "maybe", unknownOutcome: true }, 504));
    await expect(t.client.triggerFetch("orders/price", { auth: W, method: "POST", body: {} })).rejects.toMatchObject({
      unknownOutcome: true,
    });
    t.fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    await expect(t.client.triggerFetch("vault", { auth: W })).rejects.toMatchObject({ code: "network", status: 0 });
  });

  it("flags a non-JSON error body (platform / CDN error page)", async () => {
    t.signIn();
    t.fetchMock.mockResolvedValueOnce(
      new Response("<html>502 Bad Gateway</html>", { status: 502, headers: { "content-type": "text/html" } })
    );
    await expect(t.client.triggerFetch("orders/price", { auth: W, method: "POST", body: {} })).rejects.toMatchObject({
      status: 502,
      nonJson: true,
      unknownOutcome: false,
    });
    t.fetchMock.mockResolvedValueOnce(json({ error: "Bad request" }, 400));
    await expect(t.client.triggerFetch("orders/price", { auth: W, method: "POST", body: {} })).rejects.toMatchObject({
      status: 400,
      nonJson: false,
    });
  });
});

describe("logout and vault", () => {
  it("logout revokes upstream once and a late refresh cannot resurrect the session", async () => {
    const t = setup();
    t.signIn();
    t.setNow(NOW + 15 * 60_000 - 1_000);
    let release!: (r: Response) => void;
    t.fetchMock.mockImplementation((url) => {
      if (url.endsWith("auth/refresh")) return new Promise<Response>((r) => (release = r));
      return Promise.resolve(json({ success: true }));
    });
    const pending = t.client.triggerFetch("vault", { auth: W }).catch((e) => e);
    await Promise.resolve();
    await t.client.logout(W);
    await t.client.logout(W); // idempotent: no second upstream logout
    release(json(tokens(1)));
    const err = await pending;
    expect(err).toMatchObject({ code: "auth_required" });
    expect(t.sessions.get(W)).toMatchObject({ status: "signed-out", accessToken: null });
    expect(t.store.size).toBe(0);
    const logoutBodies = t.fetchMock.mock.calls
      .filter(([u]) => u.endsWith("auth/logout"))
      .map(([, init]) => JSON.parse(init.body as string).refreshToken);
    // Our token, then the late rotated token is revoked too.
    expect(logoutBodies).toEqual(["refresh-0", "refresh-1"]);
  });

  it("ensureVault: 404 -> register; 409 counts as success; cached", async () => {
    const t = setup();
    t.signIn();
    t.fetchMock
      .mockResolvedValueOnce(json({ error: "Not found" }, 404))
      .mockResolvedValueOnce(json({ error: "Vault already registered", details: { vaultPubkey: "V1", userPubkey: W } }, 409));
    expect(await t.client.ensureVault(W)).toEqual({ vaultPubkey: "V1", userPubkey: W });
    expect(await t.client.ensureVault(W)).toEqual({ vaultPubkey: "V1", userPubkey: W });
    expect(calls(t.fetchMock)).toEqual(["/api/jupiter/trigger/vault", "/api/jupiter/trigger/vault/register"]);
  });

  it("ensureVault does not cache failures", async () => {
    const t = setup();
    t.signIn();
    t.fetchMock
      .mockResolvedValueOnce(json({ error: "boom" }, 502))
      .mockResolvedValueOnce(json({ userPubkey: W, vaultPubkey: "V2", privyVaultId: "p" }));
    await expect(t.client.ensureVault(W)).rejects.toMatchObject({ status: 502 });
    expect(await t.client.ensureVault(W)).toEqual({ userPubkey: W, vaultPubkey: "V2", privyVaultId: "p" });
  });
});
