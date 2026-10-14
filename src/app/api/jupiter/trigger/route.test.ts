import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const SOL = "So11111111111111111111111111111111111111112";
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const WALLET = "BQ72nSv9f3PRyRKCBnHLVrerrv37CYTHm5h3s9VSGQDV";
const UUID = "019f0530-36a7-77da-a38f-ed9414bb996b";
const JWT = "eyJhbGciOiJIUzI1NiIs.eyJzdWIiOiJ4In0.c2lnbmF0dXJl";
const TX = "AQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAgAAEN";

const fetchMock = vi.fn();

beforeEach(() => {
  vi.resetModules();
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  vi.stubEnv("JUPITER_API_KEY", "test-key");
  vi.stubEnv("NEXT_PUBLIC_DISABLE_TRIGGER", "");
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });

const ctx = (path: string) => ({ params: Promise.resolve({ path: path.split("/") }) });

function req(
  method: string,
  path: string,
  opts: { body?: unknown; rawBody?: string; headers?: Record<string, string>; query?: string } = {}
) {
  const url = `http://x/api/jupiter/trigger/${path}${opts.query ? `?${opts.query}` : ""}`;
  return new NextRequest(url, {
    method,
    headers: { "content-type": "application/json", ...opts.headers },
    body: opts.rawBody ?? (opts.body !== undefined ? JSON.stringify(opts.body) : undefined),
  });
}

async function load() {
  return import("./[...path]/route");
}

describe("trigger proxy: routing", () => {
  it("404s unknown routes and bad ids without calling upstream", async () => {
    const { GET, POST, PATCH } = await load();
    expect((await GET(req("GET", "auth/challenge"), ctx("auth/challenge"))).status).toBe(404);
    expect((await POST(req("POST", "auth/logout-all", { body: {} }), ctx("auth/logout-all"))).status).toBe(404);
    expect((await POST(req("POST", "orders/price/cancel/123"), ctx("orders/price/cancel/123"))).status).toBe(404);
    expect((await PATCH(req("PATCH", `orders/dca/${UUID}`, { body: {} }), ctx(`orders/dca/${UUID}`))).status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("404s everything when the kill switch is on", async () => {
    vi.stubEnv("NEXT_PUBLIC_DISABLE_TRIGGER", "1");
    const { POST } = await load();
    const res = await POST(
      req("POST", "auth/challenge", { body: { walletPubkey: WALLET, type: "message" } }),
      ctx("auth/challenge")
    );
    expect(res.status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("trigger proxy: auth routes", () => {
  it("forwards a challenge with only known fields, api key, no Authorization or cookies", async () => {
    fetchMock.mockResolvedValue(json({ type: "message", challenge: "Sign this message" }));
    const { POST } = await load();
    const res = await POST(
      req("POST", "auth/challenge", {
        body: { walletPubkey: WALLET, type: "message", evil: "x" },
        headers: { cookie: "session=1", authorization: `Bearer ${JWT}` },
      }),
      ctx("auth/challenge")
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({ type: "message", challenge: "Sign this message" });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.jup.ag/trigger/v2/auth/challenge");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({ walletPubkey: WALLET, type: "message" });
    expect(init.headers["x-api-key"]).toBe("test-key");
    expect(init.headers.Authorization).toBeUndefined();
    expect(init.headers.cookie).toBeUndefined();
    expect(init.cache).toBe("no-store");
  });

  it("rejects bad bodies, bad JSON and oversized bodies", async () => {
    const { POST } = await load();
    let res = await POST(req("POST", "auth/challenge", { body: { walletPubkey: WALLET, type: "sms" } }), ctx("auth/challenge"));
    expect(res.status).toBe(400);
    res = await POST(req("POST", "auth/challenge", { rawBody: "{" }), ctx("auth/challenge"));
    expect(res.status).toBe(400);
    res = await POST(req("POST", "auth/challenge", { rawBody: JSON.stringify({ pad: "x".repeat(17_000) }) }), ctx("auth/challenge"));
    expect(res.status).toBe(413);
    res = await POST(
      req("POST", "auth/verify", { body: { type: "message", walletPubkey: WALLET, signature: "x", authMode: "access_only" } }),
      ctx("auth/verify")
    );
    expect(res.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refresh 401 is flagged as an auth error; verify 401 is not", async () => {
    const { POST } = await load();
    fetchMock.mockResolvedValueOnce(json({ error: "Unauthorized" }, 401));
    let res = await POST(
      req("POST", "auth/refresh", { body: { refreshToken: "01a08512-95d8-70ac.abcdefghijkl" } }),
      ctx("auth/refresh")
    );
    expect(res.status).toBe(401);
    expect((await res.json()).authError).toBe(true);

    fetchMock.mockResolvedValueOnce(json({ error: "Invalid signature" }, 401));
    res = await POST(
      req("POST", "auth/verify", {
        body: {
          type: "message",
          walletPubkey: WALLET,
          signature: "PPbp1QbbKDPjpHM3ScKyZBnCtLKKqmWwDeVj7USdBeEoNQsA1hkN35UQfrY2cQpyAB1pfVi9FdfciYdz7qUXBQA",
        },
      }),
      ctx("auth/verify")
    );
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Invalid signature", authError: false });
    expect(JSON.parse(fetchMock.mock.calls[1][1].body).authMode).toBe("access_refresh");
  });
});

describe("trigger proxy: authenticated routes", () => {
  const auth = { authorization: `Bearer ${JWT}`, cookie: "a=b" };

  it("requires a Bearer token", async () => {
    const { GET } = await load();
    const res = await GET(req("GET", "vault"), ctx("vault"));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Sign in to continue", authError: true });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("forwards the Bearer verbatim and allow-lists the query", async () => {
    fetchMock.mockResolvedValue(json({ orders: [], pagination: { total: 0, limit: 20, offset: 0 } }));
    const { GET } = await load();
    const res = await GET(
      req("GET", "orders/history", { headers: auth, query: `state=active&limit=100&foo=bar&mint=${SOL}` }),
      ctx("orders/history")
    );
    expect(res.status).toBe(200);
    const [url, init] = fetchMock.mock.calls[0];
    const u = new URL(url);
    expect(u.pathname).toBe("/trigger/v2/orders/history");
    expect(Object.fromEntries(u.searchParams)).toEqual({ state: "active", limit: "100", mint: SOL });
    expect(init.headers.Authorization).toBe(`Bearer ${JWT}`);
    expect(init.headers.cookie).toBeUndefined();
    expect(init.method).toBe("GET");
    expect(init.body).toBeUndefined();
  });

  it("400s a bad query", async () => {
    const { GET } = await load();
    const res = await GET(req("GET", "orders/history/dca", { headers: auth, query: "limit=500" }), ctx("orders/history/dca"));
    expect(res.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("maps a Trigger 401 to authError and a gateway 401/403 to a config error", async () => {
    const { GET } = await load();
    fetchMock.mockResolvedValueOnce(json({ error: "Unauthorized" }, 401));
    let res = await GET(req("GET", "vault", { headers: auth }), ctx("vault"));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Session expired", authError: true });

    fetchMock.mockResolvedValueOnce(json({ code: 401, message: "Invalid API key" }, 401));
    res = await GET(req("GET", "vault", { headers: auth }), ctx("vault"));
    expect(res.status).toBe(502);
    expect((await res.json()).authError).toBeUndefined();

    fetchMock.mockResolvedValueOnce(json({ code: 403, message: "API key does not have access to this endpoint" }, 403));
    res = await GET(req("GET", "vault", { headers: auth }), ctx("vault"));
    expect(res.status).toBe(502);
  });

  it("passes 4xx errors through with sanitised details", async () => {
    const { GET } = await load();
    fetchMock.mockResolvedValueOnce(
      json({ error: "Vault already registered", details: { vaultPubkey: WALLET, deep: { x: 1 } } }, 409)
    );
    const res = await GET(req("GET", "vault/register", { headers: auth }), ctx("vault/register"));
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "Vault already registered", details: { vaultPubkey: WALLET } });

    fetchMock.mockResolvedValueOnce(new Response(null, { status: 404 }));
    const res404 = await GET(req("GET", "vault", { headers: auth }), ctx("vault"));
    expect(res404.status).toBe(404);
  });

  it("maps 429 with a retry hint", async () => {
    const { GET } = await load();
    fetchMock.mockResolvedValueOnce(json({ error: "slow" }, 429, { "retry-after": "5" }));
    const res = await GET(req("GET", "vault", { headers: auth }), ctx("vault"));
    expect(res.status).toBe(429);
    expect((await res.json()).retryAfterMs).toBe(5000);
  });

  it("validates and forwards a create price order; 5xx/timeout = unknown outcome", async () => {
    const { POST } = await load();
    const body = {
      orderType: "single",
      depositRequestId: UUID,
      depositSignedTx: TX,
      userPubkey: WALLET,
      inputMint: USDC,
      inputAmount: "20000000",
      outputMint: SOL,
      triggerMint: SOL,
      triggerCondition: "below",
      triggerPriceUsd: 100,
      expiresAt: Date.now() + 86_400_000,
      trailingBps: 500,
    };
    fetchMock.mockResolvedValueOnce(json({ id: UUID, txSignature: "sig", depositConfirmed: true }));
    let res = await POST(req("POST", "orders/price", { body, headers: auth }), ctx("orders/price"));
    expect(res.status).toBe(200);
    const sent = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(sent.trailingBps).toBeUndefined();
    expect(sent.triggerPriceUsd).toBe(100);

    fetchMock.mockResolvedValueOnce(json({ error: "boom" }, 500));
    res = await POST(req("POST", "orders/price", { body, headers: auth }), ctx("orders/price"));
    expect(res.status).toBe(502);
    expect((await res.json()).unknownOutcome).toBe(true);

    const timeout = new Error("timed out");
    timeout.name = "TimeoutError";
    fetchMock.mockRejectedValueOnce(timeout);
    res = await POST(req("POST", "orders/price", { body, headers: auth }), ctx("orders/price"));
    expect(res.status).toBe(504);
    expect((await res.json()).unknownOutcome).toBe(true);

    res = await POST(req("POST", "orders/price", { body: { ...body, expiresAt: Date.now() - 1 }, headers: auth }), ctx("orders/price"));
    expect(res.status).toBe(400);
  });

  it("cancel step 1 sends no body; non-landing 5xx hides upstream text", async () => {
    const { POST } = await load();
    fetchMock.mockResolvedValueOnce(json({ id: UUID, transaction: TX, requestId: UUID }));
    let res = await POST(req("POST", `orders/dca/cancel/${UUID}`, { headers: auth, body: { x: 1 } }), ctx(`orders/dca/cancel/${UUID}`));
    expect(res.status).toBe(200);
    expect(fetchMock.mock.calls[0][1].body).toBeUndefined();
    expect(fetchMock.mock.calls[0][0]).toBe(`https://api.jup.ag/trigger/v2/orders/dca/cancel/${UUID}`);

    fetchMock.mockResolvedValueOnce(json({ error: "internal secret" }, 500));
    res = await POST(req("POST", `orders/dca/cancel/${UUID}`, { headers: auth }), ctx(`orders/dca/cancel/${UUID}`));
    expect(res.status).toBe(502);
    const b = await res.json();
    expect(b.error).not.toContain("secret");
    expect(b.unknownOutcome).toBeUndefined();
  });

  it("PATCH forwards only orderType/triggerPriceUsd/slippageBps", async () => {
    const { PATCH } = await load();
    fetchMock.mockResolvedValueOnce(json({ id: UUID }));
    const res = await PATCH(
      req("PATCH", `orders/price/${UUID}`, { headers: auth, body: { orderType: "single", triggerPriceUsd: 5, expiresAt: 1 } }),
      ctx(`orders/price/${UUID}`)
    );
    expect(res.status).toBe(200);
    expect(fetchMock.mock.calls[0][1].method).toBe("PATCH");
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ orderType: "single", triggerPriceUsd: 5 });
  });
});
