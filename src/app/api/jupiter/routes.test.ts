import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const SOL = "So11111111111111111111111111111111111111112";
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const WALLET = "2F5Pa8UBDVBtnR7q949AWmgpeQYrJKhRVLnRjqQPRkMm";

const fetchMock = vi.fn();

beforeEach(() => {
  vi.resetModules();
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  vi.stubEnv("JUPITER_API_KEY", "");
  vi.stubEnv("JUPITER_REFERRAL_ACCOUNT", "");
  vi.stubEnv("JUPITER_REFERRAL_FEE_BPS", "");
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("GET /api/jupiter/order", () => {
  it("rejects invalid params without calling upstream", async () => {
    const { GET } = await import("./order/route");
    const res = await GET(new NextRequest(`http://x/api/jupiter/order?inputMint=${SOL}&outputMint=${SOL}&amount=1`));
    expect(res.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("forwards only allowlisted params plus referral, with the api key", async () => {
    vi.stubEnv("JUPITER_API_KEY", "k");
    vi.stubEnv("JUPITER_REFERRAL_ACCOUNT", WALLET);
    vi.stubEnv("JUPITER_REFERRAL_FEE_BPS", "60");
    fetchMock.mockResolvedValue(json({ outAmount: "1" }));
    const { GET } = await import("./order/route");
    const res = await GET(
      new NextRequest(
        `http://x/api/jupiter/order?inputMint=${SOL}&outputMint=${USDC}&amount=100&taker=${WALLET}&payer=${WALLET}`
      )
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const [url, init] = fetchMock.mock.calls[0];
    const u = new URL(url);
    expect(u.origin + u.pathname).toBe("https://api.jup.ag/swap/v2/order");
    expect(Object.fromEntries(u.searchParams)).toEqual({
      inputMint: SOL,
      outputMint: USDC,
      amount: "100",
      taker: WALLET,
      referralAccount: WALLET,
      referralFee: "60",
    });
    expect(init.headers["x-api-key"]).toBe("k");
    expect(init.cache).toBe("no-store");
  });

  it("maps 429 and other upstream errors", async () => {
    const { GET } = await import("./order/route");
    const url = `http://x/api/jupiter/order?inputMint=${SOL}&outputMint=${USDC}&amount=1`;
    fetchMock.mockResolvedValueOnce(json({ error: "slow down" }, 429));
    let res = await GET(new NextRequest(url));
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("2");
    expect(await res.json()).toEqual({
      error: "Rate limited by Jupiter, please retry",
      retryAfterMs: 2000,
    });

    fetchMock.mockResolvedValueOnce(json({ error: "Could not find any route" }, 400));
    res = await GET(new NextRequest(url));
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "Could not find any route" });

    fetchMock.mockResolvedValueOnce(json({ error: "internal secret detail" }, 500));
    res = await GET(new NextRequest(url));
    expect(res.status).toBe(502);
    expect((await res.json()).error).toBe("Jupiter order failed (500)");

    fetchMock.mockRejectedValueOnce(Object.assign(new Error("t"), { name: "TimeoutError" }));
    res = await GET(new NextRequest(url));
    expect(res.status).toBe(502);
  });

  it("passes a Retry-After derived from x-ratelimit-reset (unix seconds) on 429", async () => {
    const { GET } = await import("./order/route");
    const reset = Math.floor(Date.now() / 1000) + 7;
    fetchMock.mockResolvedValueOnce(
      new Response("{}", { status: 429, headers: { "x-ratelimit-reset": String(reset) } })
    );
    const res = await GET(
      new NextRequest(`http://x/api/jupiter/order?inputMint=${SOL}&outputMint=${USDC}&amount=1`)
    );
    expect(res.status).toBe(429);
    const ra = Number(res.headers.get("retry-after"));
    expect(ra).toBeGreaterThanOrEqual(6);
    expect(ra).toBeLessThanOrEqual(8);
    expect((await res.json()).retryAfterMs).toBe(ra * 1000);
  });
});

describe("retryAfterSeconds", () => {
  const now = 1_700_000_000_000;
  const h = (init: Record<string, string>) => new Headers(init);

  it("uses the absolute reset timestamp, clamped to 1..60", async () => {
    const { retryAfterSeconds } = await import("@/lib/jupiter/server");
    expect(retryAfterSeconds(h({ "x-ratelimit-reset": String(now / 1000 + 5) }), now)).toBe(5);
    expect(retryAfterSeconds(h({ "x-ratelimit-reset": String(now / 1000 - 5) }), now)).toBe(1);
    expect(retryAfterSeconds(h({ "x-ratelimit-reset": String(now / 1000 + 600) }), now)).toBe(60);
  });

  it("falls back to Retry-After, then to 2s", async () => {
    const { retryAfterSeconds } = await import("@/lib/jupiter/server");
    expect(retryAfterSeconds(h({ "retry-after": "3" }), now)).toBe(3);
    expect(retryAfterSeconds(h({}), now)).toBe(2);
    expect(retryAfterSeconds(h({ "x-ratelimit-reset": "soon" }), now)).toBe(2);
  });
});

describe("POST /api/jupiter/execute", () => {
  const post = (body: string) =>
    new Request("http://x/api/jupiter/execute", { method: "POST", body });

  it("validates the body", async () => {
    const { POST } = await import("./execute/route");
    expect((await POST(post("not json"))).status).toBe(400);
    expect((await POST(post(JSON.stringify({ requestId: "a" })))).status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects an oversized Content-Length with 413 before reading the body", async () => {
    const { POST } = await import("./execute/route");
    const req = new Request("http://x/api/jupiter/execute", {
      method: "POST",
      headers: { "content-length": "9000" },
      body: "{}",
    });
    const res = await POST(req);
    expect(res.status).toBe(413);
    expect(await res.json()).toMatchObject({ status: "Failed", code: -2 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects an oversized streamed (chunked) body with 413", async () => {
    const { POST } = await import("./execute/route");
    const enc = new TextEncoder();
    const chunks = ['{"signedTransaction":"', ...Array<string>(10).fill("A".repeat(1024)), '"}'];
    let i = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(ctrl) {
        if (i < chunks.length) ctrl.enqueue(enc.encode(chunks[i++]));
        else ctrl.close();
      },
    });
    const req = new Request("http://x/api/jupiter/execute", {
      method: "POST",
      body: stream,
      // @ts-expect-error -- undici requires duplex for stream bodies
      duplex: "half",
    });
    expect(req.headers.get("content-length")).toBeNull();
    const res = await POST(req);
    expect(res.status).toBe(413);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("forwards only signedTransaction and requestId", async () => {
    fetchMock.mockResolvedValue(json({ status: "Success", code: 0, signature: "sig" }));
    const { POST } = await import("./execute/route");
    const res = await POST(post(JSON.stringify({ signedTransaction: "AQID", requestId: "r-1", evil: 1 })));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "Success", code: 0, signature: "sig" });
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ signedTransaction: "AQID", requestId: "r-1" });
  });

  it("maps upstream failures and timeouts", async () => {
    const { POST } = await import("./execute/route");
    const body = JSON.stringify({ signedTransaction: "AQID", requestId: "r-1" });
    fetchMock.mockResolvedValueOnce(json({ error: "bad", code: -2 }, 400));
    let res = await POST(post(body));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ status: "Failed", error: "bad", code: -2 });

    fetchMock.mockRejectedValueOnce(Object.assign(new Error("t"), { name: "TimeoutError" }));
    res = await POST(post(body));
    expect(res.status).toBe(504);
    expect((await res.json()).code).toBe(-10000);
  });

  it("treats a code-less 4xx as rejected (not sent) and a code-less 5xx as unknown", async () => {
    const { POST } = await import("./execute/route");
    const body = JSON.stringify({ signedTransaction: "AQID", requestId: "r-1" });
    fetchMock.mockResolvedValueOnce(json({ error: "slow down" }, 429));
    let res = await POST(post(body));
    expect(res.status).toBe(429);
    expect((await res.json()).code).toBe(-10001);

    fetchMock.mockResolvedValueOnce(new Response("gateway error", { status: 502 }));
    res = await POST(post(body));
    expect(res.status).toBe(502);
    expect((await res.json()).code).toBe(-10000);
  });
});

describe("GET /api/jupiter/tokens", () => {
  it("validates, caches and maps errors", async () => {
    const { GET } = await import("./tokens/route");
    expect((await GET(new NextRequest("http://x/api/jupiter/tokens?query=%20"))).status).toBe(400);

    fetchMock.mockResolvedValueOnce(json([{ id: SOL, symbol: "SOL", decimals: 9 }]));
    let res = await GET(new NextRequest("http://x/api/jupiter/tokens?query=sol"));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toContain("s-maxage=60");

    fetchMock.mockResolvedValueOnce(json({ error: "x" }, 500));
    res = await GET(new NextRequest("http://x/api/jupiter/tokens?query=sol"));
    expect(res.status).toBe(502);

    fetchMock.mockResolvedValueOnce(json({ error: "x" }, 429));
    res = await GET(new NextRequest("http://x/api/jupiter/tokens?query=sol"));
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("2");
    expect(res.headers.get("cache-control")).toBe("no-store");
  });
});
