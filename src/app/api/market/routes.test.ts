import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const SOL = "So11111111111111111111111111111111111111112";
const JUP = "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN";
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const SOL_POOL = "Czfq3xZZDmsdGdUyrNLtRhGc47cXcZtLG4crryfu44zE";
// Not curated: exercises search + pool resolution.
const RANDOM = "2F5Pa8UBDVBtnR7q949AWmgpeQYrJKhRVLnRjqQPRkMm";
const RANDOM_POOL = "58oQChx4yWmvKdwLLZzBi4ChoCc2fqCUWBkwMihLYQo2";
const NOW = Date.parse("2026-10-14T06:30:00Z");
const HOUR = 3600;
const CURRENT_BUCKET = Math.floor(NOW / 1000 / HOUR) * HOUR;

const fetchMock = vi.fn();
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

type Handler = (url: URL) => Response | Promise<Response>;
let handlers: Record<string, Handler>;

function route(url: string): Promise<Response> {
  const u = new URL(url);
  for (const [prefix, h] of Object.entries(handlers)) {
    if ((u.origin + u.pathname).startsWith(prefix)) return Promise.resolve(h(u));
  }
  throw new Error(`unexpected fetch ${url}`);
}

const calls = (prefix: string) =>
  fetchMock.mock.calls.filter(([u]) => String(u).startsWith(prefix)).length;

const PRICE = "https://api.jup.ag/price/v3";
const SEARCH = "https://api.jup.ag/tokens/v2/search";
const GT = "https://api.geckoterminal.com/api/v2";

function priceHandler(u: URL) {
  const body: Record<string, unknown> = {};
  for (const id of u.searchParams.get("ids")!.split(",")) {
    if (id === SOL) body[id] = { usdPrice: 107.5, priceChange24h: -1.2 };
    else if (id === RANDOM) body[id] = { usdPrice: 0.5, priceChange24h: 3 };
    else body[id] = { usdPrice: 1, priceChange24h: null };
  }
  return json(body);
}

function searchHandler(u: URL) {
  return json(
    u.searchParams
      .get("query")!
      .split(",")
      .filter((id) => id !== "unknownMint")
      .map((id) => ({
        id,
        symbol: id === SOL ? "SOL" : "TKN",
        name: "Token",
        decimals: 9,
        isVerified: id === SOL ? true : null,
        holderCount: 10,
        mcap: 1e9,
        liquidity: 5e6,
        tokenProgram: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
        stats24h: { priceChange: -1, buyVolume: 100, sellVolume: 50 },
        usdPrice: 107,
      }))
  );
}

function ohlcv(rows: number[][]) {
  return json({ data: { attributes: { ohlcv_list: rows } } });
}

function gtHandler(u: URL) {
  if (u.pathname.includes("/ohlcv/")) {
    return ohlcv([
      [CURRENT_BUCKET, 107, 108, 106, 107.5, 10],
      [CURRENT_BUCKET - HOUR, 105, 110, 104, 107, 10],
      [CURRENT_BUCKET - 23 * HOUR, 100, 101, 99, 100, 10],
      [CURRENT_BUCKET - 30 * HOUR, 50, 200, 10, 60, 10],
    ]);
  }
  if (u.pathname.endsWith("/trades")) {
    return json({
      data: [
        {
          id: "t1",
          attributes: {
            block_timestamp: "2026-10-14T06:29:00Z",
            tx_hash: "2XMV4oKVKVp1M4Nb159WvB28mXuSiR3yBnMUGP361nP7aET8k7pGJrU9iUqNkuCHmy4sAieYx9SywHYqsJxshepv",
            kind: "buy",
            from_token_address: USDC,
            to_token_address: SOL,
            from_token_amount: "107.5",
            to_token_amount: "1",
            price_to_in_usd: "107.5",
            volume_in_usd: "107.5",
          },
        },
      ],
    });
  }
  if (u.pathname.endsWith(`/tokens/${RANDOM}/pools`)) {
    return json({
      data: [
        {
          attributes: { address: RANDOM_POOL, name: "TKN / SOL", reserve_in_usd: "50000" },
          relationships: {
            base_token: { data: { id: `solana_${RANDOM}` } },
            quote_token: { data: { id: `solana_${SOL}` } },
            dex: { data: { id: "raydium" } },
          },
        },
      ],
    });
  }
  return json({ errors: [{ status: "404" }] }, 404);
}

const ctx = (mint: string) => ({ params: Promise.resolve({ mint }) });
const req = (path: string) => new NextRequest(`http://x${path}`);

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  fetchMock.mockReset();
  fetchMock.mockImplementation((url: string) => route(url));
  vi.stubGlobal("fetch", fetchMock);
  vi.stubEnv("JUPITER_API_KEY", "k");
  vi.stubEnv("CG_DEMO_API_KEY", "");
  handlers = { [PRICE]: priceHandler, [SEARCH]: searchHandler, [GT]: gtHandler };
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("GET /api/markets", () => {
  it("merges the curated list with prices and stats in two upstream calls", async () => {
    const { GET } = await import("../markets/route");
    const res = await GET();
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("public, s-maxage=10, stale-while-revalidate=10");
    const body = await res.json();
    expect(body.stale).toBeUndefined();
    expect(body.updatedAt).toBe(NOW);
    const sol = body.markets.find((m: { mint: string }) => m.mint === SOL);
    expect(sol).toMatchObject({
      symbol: "SOL",
      priceUsd: 107.5,
      change24hPct: -1.2,
      volume24hUsd: 150,
      mcapUsd: 1e9,
      liquidityUsd: 5e6,
      isVerified: true,
      tier: "core",
    });
    expect(body.markets.some((m: { mint: string }) => m.mint === USDC)).toBe(false);
    expect(calls(PRICE)).toBe(1);
    expect(calls(SEARCH)).toBe(1);

    // Concurrent and repeat visitors within the TTL cost nothing upstream.
    await Promise.all([GET(), GET(), GET()]);
    expect(calls(PRICE) + calls(SEARCH)).toBe(2);
  });

  it("shortens s-maxage to what is left of the server TTL", async () => {
    const { GET } = await import("../markets/route");
    await GET();
    vi.setSystemTime(NOW + 7_500);
    const res = await GET();
    expect(res.headers.get("cache-control")).toBe("public, s-maxage=3, stale-while-revalidate=3");
    expect(calls(PRICE)).toBe(1);
  });

  it("serves the list with prices missing and stale: true when only stats are available", async () => {
    handlers[PRICE] = () => json({}, 429);
    const { GET } = await import("../markets/route");
    const res = await GET();
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("public, s-maxage=5");
    const body = await res.json();
    expect(body.stale).toBe(true);
    // Falls back to the stats' own price.
    expect(body.markets.find((m: { mint: string }) => m.mint === SOL).priceUsd).toBe(107);
  });

  it("serves the last good data marked stale when Jupiter fails", async () => {
    const { GET } = await import("../markets/route");
    await GET();
    vi.setSystemTime(NOW + 11_000);
    handlers[PRICE] = () => json({ error: "down" }, 500);
    const res = await GET();
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("public, s-maxage=5");
    const body = await res.json();
    expect(body.stale).toBe(true);
    expect(body.updatedAt).toBe(NOW);
    expect(body.markets[0].priceUsd).toBe(107.5);
  });

  it("returns 503 with Retry-After when nothing is cached", async () => {
    handlers[PRICE] = () => json({}, 429);
    handlers[SEARCH] = () => json({}, 502);
    const { GET } = await import("../markets/route");
    const res = await GET();
    expect(res.status).toBe(503);
    expect(Number(res.headers.get("retry-after"))).toBeGreaterThan(0);
    expect(res.headers.get("cache-control")).toBe("no-store");
  });
});

describe("GET /api/market/[mint]", () => {
  it("rejects an invalid mint without calling upstream", async () => {
    const { GET } = await import("./[mint]/route");
    const res = await GET(req("/api/market/nope"), ctx("nope"));
    expect(res.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("builds the header for a curated mint with 24h high/low from shared 1h candles", async () => {
    const { GET } = await import("./[mint]/route");
    const res = await GET(req(`/api/market/${SOL}`), ctx(SOL));
    expect(res.status).toBe(200);
    // Curated prices live 10s, so the header is shared for at most that long.
    expect(res.headers.get("cache-control")).toBe("public, s-maxage=10, stale-while-revalidate=10");
    const body = await res.json();
    expect(body).toMatchObject({
      mint: SOL,
      symbol: "SOL",
      tier: "core",
      priceUsd: 107.5,
      holderCount: 10,
      high24hUsd: 110,
      low24hUsd: 99,
      pool: { address: SOL_POOL, dex: "orca", quoteSymbol: "USDC" },
    });
    // Hardcoded pool: no GT pool lookup; one 1h OHLCV call.
    expect(calls(`${GT}/networks/solana/tokens/`)).toBe(0);
    expect(calls(`${GT}/networks/solana/pools/${SOL_POOL}/ohlcv/hour`)).toBe(1);

    // The chart's 1h request reuses the same cached candles.
    const candles = await import("./[mint]/candles/route");
    const cres = await candles.GET(req(`/api/market/${SOL}/candles?tf=1h`), ctx(SOL));
    const cbody = await cres.json();
    expect(cbody.candles).toHaveLength(4);
    expect(cbody.pool).toEqual({ address: SOL_POOL, dex: "orca" });
    expect(calls(`${GT}/`)).toBe(1);
  });

  it("resolves the pool for a non-curated mint and caches it", async () => {
    const { GET } = await import("./[mint]/route");
    const body = await (await GET(req(`/api/market/${RANDOM}`), ctx(RANDOM))).json();
    expect(body).toMatchObject({
      tier: "search",
      isVerified: false,
      priceUsd: 0.5,
      pool: { address: RANDOM_POOL, dex: "raydium", quoteSymbol: "SOL" },
    });
    const trades = await import("./[mint]/trades/route");
    await trades.GET(req(`/api/market/${RANDOM}/trades`), ctx(RANDOM));
    expect(calls(`${GT}/networks/solana/tokens/${RANDOM}/pools`)).toBe(1);
  });

  it("fetches a non-curated mint's stats and price per mint, with the curated set riding along", async () => {
    const { GET } = await import("./[mint]/route");
    const res = await GET(req(`/api/market/${RANDOM}`), ctx(RANDOM));
    expect(res.headers.get("cache-control")).toBe("public, s-maxage=15, stale-while-revalidate=15");
    expect(calls(PRICE)).toBe(1);
    expect(calls(SEARCH)).toBe(1);
    const priceIds = new URL(fetchMock.mock.calls.find(([u]) => String(u).startsWith(PRICE))![0]).searchParams
      .get("ids")!
      .split(",");
    expect(priceIds[0]).toBe(RANDOM);
    expect(priceIds).toContain(SOL);
    // The list and the curated header now cost nothing upstream.
    const markets = await import("../markets/route");
    expect((await (await markets.GET()).json()).stale).toBeUndefined();
    await GET(req(`/api/market/${SOL}`), ctx(SOL));
    expect(calls(PRICE)).toBe(1);
    expect(calls(SEARCH)).toBe(1);
  });

  it("serves the header stale when only the price refresh fails", async () => {
    const { GET } = await import("./[mint]/route");
    await GET(req(`/api/market/${RANDOM}`), ctx(RANDOM));
    vi.setSystemTime(NOW + 16_000);
    handlers[PRICE] = () => json({}, 500);
    const res = await GET(req(`/api/market/${RANDOM}`), ctx(RANDOM));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("public, s-maxage=5");
    expect(await res.json()).toMatchObject({ priceUsd: 0.5, stale: true });
  });

  it("returns 503 when a non-curated mint's stats cannot be fetched", async () => {
    handlers[SEARCH] = () => json({}, 502);
    const { GET } = await import("./[mint]/route");
    const res = await GET(req(`/api/market/${RANDOM}`), ctx(RANDOM));
    expect(res.status).toBe(503);
  });

  it("returns 404 for a mint Jupiter does not know", async () => {
    handlers[SEARCH] = () => json([]);
    const { GET } = await import("./[mint]/route");
    const res = await GET(req(`/api/market/${RANDOM}`), ctx(RANDOM));
    expect(res.status).toBe(404);
  });
});

describe("GET /api/market/[mint]/candles", () => {
  it("validates tf", async () => {
    const { GET } = await import("./[mint]/candles/route");
    expect((await GET(req(`/api/market/${SOL}/candles`), ctx(SOL))).status).toBe(400);
    expect((await GET(req(`/api/market/${SOL}/candles?tf=2h`), ctx(SOL))).status).toBe(400);
    expect((await GET(req(`/api/market/${SOL}/candles?tf=1h&tf=1d`), ctx(SOL))).status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns an empty chart when GT has no pool", async () => {
    handlers[GT] = () => json({ errors: [] }, 404);
    const { GET } = await import("./[mint]/candles/route");
    const res = await GET(req(`/api/market/${RANDOM}/candles?tf=5m`), ctx(RANDOM));
    expect(await res.json()).toMatchObject({ mint: RANDOM, tf: "5m", pool: null, candles: [] });
  });

  it("maps a GT 429 with nothing cached to 503 Retry-After 60", async () => {
    handlers[GT] = () => new Response("{}", { status: 429, headers: { "retry-after": "0" } });
    const { GET } = await import("./[mint]/candles/route");
    const res = await GET(req(`/api/market/${SOL}/candles?tf=15m`), ctx(SOL));
    expect(res.status).toBe(503);
    expect(res.headers.get("retry-after")).toBe("60");
  });
});

describe("GET /api/market/[mint]/trades", () => {
  it("returns normalised trades for the pool", async () => {
    const { GET } = await import("./[mint]/trades/route");
    const res = await GET(req(`/api/market/${SOL}/trades`), ctx(SOL));
    expect(res.headers.get("cache-control")).toContain("s-maxage=60");
    const body = await res.json();
    expect(body.pool).toEqual({ address: SOL_POOL, dex: "orca" });
    expect(body.trades).toEqual([
      expect.objectContaining({ id: "t1", side: "buy", priceUsd: 107.5, amount: 1, volumeUsd: 107.5 }),
    ]);
    const u = new URL(fetchMock.mock.calls[0][0]);
    expect(u.searchParams.get("token")).toBe(SOL);
  });
});

describe("GET /api/market/prices", () => {
  it("validates ids", async () => {
    const { GET } = await import("./prices/route");
    expect((await GET(req("/api/market/prices"))).status).toBe(400);
    expect((await GET(req("/api/market/prices?ids=bad"))).status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fetches every requested mint in one call and caches each mint for the list", async () => {
    const { GET } = await import("./prices/route");
    const res = await GET(req(`/api/market/prices?ids=${SOL},${RANDOM},${JUP}`));
    expect(res.status).toBe(200);
    // SOL and JUP are curated (10s), so the response is shared for 10s at most.
    expect(res.headers.get("cache-control")).toBe("public, s-maxage=10, stale-while-revalidate=10");
    const body = await res.json();
    expect(body.stale).toBeUndefined();
    expect(body.prices).toEqual({
      [SOL]: { usdPrice: 107.5, change24hPct: -1.2 },
      [RANDOM]: { usdPrice: 0.5, change24hPct: 3 },
      [JUP]: { usdPrice: 1, change24hPct: null },
    });
    expect(calls(PRICE)).toBe(1);
    // The rest of the curated set rode along, so the list needs no price call.
    const markets = await import("../markets/route");
    await markets.GET();
    expect(calls(PRICE)).toBe(1);
  });

  it("shares per-mint entries between wallets and fetches only the missing mints", async () => {
    const { GET } = await import("./prices/route");
    const OTHER = RANDOM_POOL; // any valid pubkey
    await GET(req(`/api/market/prices?ids=${USDC},${RANDOM}`));
    expect(calls(PRICE)).toBe(1);
    // A second wallet: USDC is cached and the curated set rode along, so only OTHER is fetched.
    const res = await GET(req(`/api/market/prices?ids=${OTHER},${USDC}`));
    expect(calls(PRICE)).toBe(2);
    const ids = new URL(fetchMock.mock.calls.filter(([u]) => String(u).startsWith(PRICE))[1][0]).searchParams.get(
      "ids"
    );
    expect(ids).toBe(OTHER);
    expect(Object.keys((await res.json()).prices).sort()).toEqual([OTHER, USDC].sort());
    // A third request already fully cached costs nothing.
    await GET(req(`/api/market/prices?ids=${RANDOM},${OTHER}`));
    expect(calls(PRICE)).toBe(2);
  });

  it("returns what is available with stale: true when the missing mints cannot be fetched", async () => {
    const { GET } = await import("./prices/route");
    await GET(req(`/api/market/prices?ids=${SOL}`));
    handlers[PRICE] = () => json({}, 429);
    const res = await GET(req(`/api/market/prices?ids=${SOL},${RANDOM}`));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("public, s-maxage=5");
    const body = await res.json();
    expect(body.stale).toBe(true);
    // SOL is still fresh; RANDOM is simply absent.
    expect(body.prices).toEqual({ [SOL]: { usdPrice: 107.5, change24hPct: -1.2 } });
  });

  it("returns 503 with Retry-After when none of the mints is available", async () => {
    handlers[PRICE] = () => new Response("{}", { status: 429, headers: { "retry-after": "9" } });
    const { GET } = await import("./prices/route");
    const res = await GET(req(`/api/market/prices?ids=${RANDOM}`));
    expect(res.status).toBe(503);
    expect(res.headers.get("retry-after")).toBe("9");
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("serves an empty, non-stale result for mints Jupiter has no price for", async () => {
    handlers[PRICE] = () => json({});
    const { GET } = await import("./prices/route");
    const body = await (await GET(req(`/api/market/prices?ids=${RANDOM}`))).json();
    expect(body.prices).toEqual({});
    expect(body.stale).toBeUndefined();
  });
});

describe("Jupiter market-data budget", () => {
  it("allows 40 calls/min with a key and 10 keyless", async () => {
    const { jupiterBudgetPerMinute } = await import("@/lib/markets/jupiter");
    expect(jupiterBudgetPerMinute()).toBe(40);
    vi.stubEnv("JUPITER_API_KEY", "");
    expect(jupiterBudgetPerMinute()).toBe(10);
  });
});
