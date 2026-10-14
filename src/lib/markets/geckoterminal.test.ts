import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cooldownRemainingMs, resetServerCache, UpstreamError } from "@/lib/server/cache";
import {
  getCandles,
  getTopPool,
  getTrades,
  GT_UPSTREAM,
  gtConfig,
  parseOhlcv,
  parsePools,
  parseTrades,
  selectTopPool,
} from "./geckoterminal";

const SOL = "So11111111111111111111111111111111111111112";
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const BONK = "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263";
const OTHER = "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN";
const POOL_A = "Czfq3xZZDmsdGdUyrNLtRhGc47cXcZtLG4crryfu44zE";
const POOL_B = "58oQChx4yWmvKdwLLZzBi4ChoCc2fqCUWBkwMihLYQo2";
const POOL_C = "7mHdMhMnEpXSjF6hoj2wxRnzkSE1KwePq5UErjwnrLs7";
const BONK_POOL = "5zpyutJu9ee6jFymDGoK7F6S5Kczqtc9FomP3ueKuyA9";
const WALLET = "4XBqViD1XYF1qHrErrsXBzDrCapvP9fEFX4LPjXZi9YU";
const TX = "2XMV4oKVKVp1M4Nb159WvB28mXuSiR3yBnMUGP361nP7aET8k7pGJrU9iUqNkuCHmy4sAieYx9SywHYqsJxshepv";

function pool(address: string, base: string, quote: string, reserve: string, dex = "orca", name = "A / B") {
  return {
    id: `solana_${address}`,
    type: "pool",
    attributes: { address, name, reserve_in_usd: reserve, market_cap_usd: "1" },
    relationships: {
      base_token: { data: { id: `solana_${base}`, type: "token" } },
      quote_token: { data: { id: `solana_${quote}`, type: "token" } },
      dex: { data: { id: dex, type: "dex" } },
    },
  };
}

const fetchMock = vi.fn();
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

beforeEach(() => {
  resetServerCache();
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  vi.stubEnv("CG_DEMO_API_KEY", "");
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("gtConfig", () => {
  it("uses keyless GeckoTerminal without a key", () => {
    const c = gtConfig();
    expect(c.baseUrl).toBe("https://api.geckoterminal.com/api/v2");
    expect(c.headers["x-cg-demo-api-key"]).toBeUndefined();
  });

  it("uses CoinGecko onchain with the demo key header when set", () => {
    vi.stubEnv("CG_DEMO_API_KEY", " demo-key ");
    const c = gtConfig();
    expect(c.baseUrl).toBe("https://api.coingecko.com/api/v3/onchain");
    expect(c.headers["x-cg-demo-api-key"]).toBe("demo-key");
    expect(c.perMinute).toBe(80);
  });
});

describe("parsePools / selectTopPool", () => {
  it("prefers the highest-reserve pool paired with USDC/USDT/SOL", () => {
    const body = {
      data: [
        pool(POOL_B, SOL, USDC, "24817704.43", "raydium", "SOL / USDC"),
        pool(POOL_C, OTHER, SOL, "99999999", "pumpswap", "PULT / SOL"),
        pool(POOL_A, SOL, USDC, "28596950.78", "orca", "SOL / USDC"),
      ],
    };
    // POOL_C pairs SOL with a random token: not preferred despite its reserve.
    expect(selectTopPool(parsePools(body, SOL))).toEqual({
      address: POOL_A,
      dex: "orca",
      quoteSymbol: "USDC",
      reserveUsd: 28596950.78,
    });
  });

  it("handles the token being the pool's quote side", () => {
    const body = { data: [pool(BONK_POOL, BONK, SOL, "350782", "orca", "Bonk / SOL")] };
    expect(selectTopPool(parsePools(body, SOL))).toMatchObject({ address: BONK_POOL, quoteSymbol: "Bonk" });
    expect(selectTopPool(parsePools(body, BONK))).toMatchObject({ address: BONK_POOL, quoteSymbol: "SOL" });
  });

  it("falls back to the highest reserve overall when no pool qualifies", () => {
    const body = {
      data: [
        pool(POOL_A, BONK, SOL, "9000", "orca", "Bonk / SOL"),
        pool(POOL_B, BONK, OTHER, "50000", "meteora", "Bonk / PULT 0.25%"),
      ],
    };
    expect(selectTopPool(parsePools(body, BONK))).toMatchObject({ address: POOL_B, quoteSymbol: "PULT" });
  });

  it("drops malformed rows and pools that do not contain the mint", () => {
    const body = {
      data: [
        null,
        { attributes: { address: "nope" } },
        pool(POOL_A, OTHER, USDC, "1000000"),
        { ...pool(POOL_B, BONK, SOL, "1000"), relationships: {} },
      ],
    };
    expect(parsePools(body, BONK)).toEqual([]);
    expect(selectTopPool([])).toBeNull();
    expect(parsePools({ data: "x" }, BONK)).toEqual([]);
    expect(parsePools(null, BONK)).toEqual([]);
  });
});

describe("parseOhlcv", () => {
  it("reverses newest-first rows, dedupes by time and drops malformed rows", () => {
    const body = {
      data: {
        attributes: {
          ohlcv_list: [
            [1791957600, 107.2172, 107.4456, 106.8865, 107.1743, 1542.36],
            [1791957600, 1, 1, 1, 1, 1],
            [1791954000, "107.93", 108.2, 107.3, 107.95, 2840929.98],
            [1791950400, 3.249240793449445e-6, 3.2511557789270507e-6, 3.204268208762665e-6, 3.21e-6, 6121.6],
            [1791946800, null, 1, 1, 1, 1],
            [1791943200, 1, 1, 1],
            ["x", 1, 1, 1, 1, 1],
            [1791939600, 0, 1, 1, 1, 1],
            "garbage",
          ],
        },
      },
    };
    const candles = parseOhlcv(body);
    expect(candles.map((c) => c.time)).toEqual([1791950400, 1791954000, 1791957600]);
    expect(candles[2]).toEqual({
      time: 1791957600,
      open: 107.2172,
      high: 107.4456,
      low: 106.8865,
      close: 107.1743,
      volume: 1542.36,
    });
    expect(candles[1].open).toBe(107.93);
    expect(candles[0].close).toBe(3.21e-6);
  });

  it("keeps high/low consistent with open/close and clamps bad volume", () => {
    const [c] = parseOhlcv({ data: { attributes: { ohlcv_list: [[100, 5, 4, 6, 3, -1]] } } });
    expect(c).toEqual({ time: 100, open: 5, high: 5, low: 3, close: 3, volume: 0 });
  });

  it("returns [] for unexpected shapes", () => {
    expect(parseOhlcv(null)).toEqual([]);
    expect(parseOhlcv({ data: { attributes: {} } })).toEqual([]);
  });
});

describe("parseTrades", () => {
  const buy = {
    id: `solana_456730301_${TX}_14_1791957471`,
    type: "trade",
    attributes: {
      block_timestamp: "2026-10-14T05:57:32Z",
      tx_hash: TX,
      tx_from_address: WALLET,
      kind: "buy",
      from_token_address: SOL,
      to_token_address: BONK,
      from_token_amount: "0.709726586",
      to_token_amount: "23683024.19018",
      price_from_in_usd: "107.212967324516691243638126867",
      price_to_in_usd: "0.0000032129297619731245096589440870309377595710098",
      volume_in_usd: "76.09189327415878537636338",
    },
  };
  const sell = {
    id: "solana_456727705_sell_51",
    type: "trade",
    attributes: {
      block_timestamp: "2026-10-14T05:58:09Z",
      tx_hash: TX,
      tx_from_address: "not-a-wallet",
      kind: "sell",
      from_token_address: BONK,
      to_token_address: SOL,
      from_token_amount: "260975830.44753",
      to_token_amount: "7.810667927",
      price_from_in_usd: "0.00000321006051502120313117",
      price_to_in_usd: "107.256923034526591857050941565",
      volume_in_usd: "837.748208694484337",
    },
  };

  it("maps both legs relative to the mint, newest first", () => {
    const trades = parseTrades({ data: [buy, sell] }, BONK);
    expect(trades).toEqual([
      {
        id: "solana_456727705_sell_51",
        ts: Date.parse("2026-10-14T05:58:09Z"),
        side: "sell",
        priceUsd: 0.00000321006051502120313117,
        amount: 260975830.44753,
        volumeUsd: 837.748208694484337,
        txHash: TX,
      },
      {
        id: buy.id,
        ts: Date.parse("2026-10-14T05:57:32Z"),
        side: "buy",
        priceUsd: 0.0000032129297619731245,
        amount: 23683024.19018,
        volumeUsd: Number("76.09189327415878537636338"),
        txHash: TX,
        wallet: WALLET,
      },
    ]);
  });

  it("uses the SOL leg when charting SOL from the same pool", () => {
    const [t] = parseTrades({ data: [buy] }, SOL);
    expect(t).toMatchObject({ side: "sell", amount: 0.709726586, priceUsd: 107.21296732451669 });
  });

  it("drops duplicates, unrelated legs and malformed rows", () => {
    const bad = (patch: Record<string, unknown>) => ({ ...buy, id: Math.random().toString(), attributes: { ...buy.attributes, ...patch } });
    const trades = parseTrades(
      {
        data: [
          buy,
          buy,
          bad({ to_token_address: OTHER }),
          bad({ price_to_in_usd: "NaN" }),
          bad({ to_token_amount: "0" }),
          bad({ volume_in_usd: null }),
          bad({ block_timestamp: "not a date" }),
          bad({ tx_hash: "<script>" }),
          null,
          { id: "x" },
        ],
      },
      BONK
    );
    expect(trades).toHaveLength(1);
    expect(parseTrades({}, BONK)).toEqual([]);
  });
});

describe("network calls", () => {
  it("requests candles with the tf mapping, token=<mint> and currency=usd", async () => {
    fetchMock.mockResolvedValue(json({ data: { attributes: { ohlcv_list: [[1, 2, 3, 1, 2, 5]] } } }));
    const candles = await getCandles(BONK_POOL, SOL, "4h");
    expect(candles).toHaveLength(1);
    const [url, init] = fetchMock.mock.calls[0];
    const u = new URL(url);
    expect(u.origin + u.pathname).toBe(
      `https://api.geckoterminal.com/api/v2/networks/solana/pools/${BONK_POOL}/ohlcv/hour`
    );
    expect(Object.fromEntries(u.searchParams)).toEqual({ aggregate: "4", limit: "300", currency: "usd", token: SOL });
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it.each([
    ["1m", "minute", "1"],
    ["5m", "minute", "5"],
    ["15m", "minute", "15"],
    ["1h", "hour", "1"],
    ["1d", "day", "1"],
  ] as const)("maps %s to %s/%s", async (tf, timeframe, aggregate) => {
    fetchMock.mockResolvedValue(json({ data: { attributes: { ohlcv_list: [] } } }));
    await getCandles(POOL_A, SOL, tf);
    const u = new URL(fetchMock.mock.calls[0][0]);
    expect(u.pathname.endsWith(`/ohlcv/${timeframe}`)).toBe(true);
    expect(u.searchParams.get("aggregate")).toBe(aggregate);
  });

  it("sends the demo key to the CoinGecko onchain base when configured", async () => {
    vi.stubEnv("CG_DEMO_API_KEY", "k");
    fetchMock.mockResolvedValue(json({ data: [] }));
    await getTrades(POOL_A, SOL);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toMatch(/^https:\/\/api\.coingecko\.com\/api\/v3\/onchain\/networks\/solana\/pools\//);
    expect(new URL(url).searchParams.get("token")).toBe(SOL);
    expect(init.headers["x-cg-demo-api-key"]).toBe("k");
  });

  it("maps 404 to no pool", async () => {
    fetchMock.mockResolvedValue(json({ errors: [{ status: "404" }] }, 404));
    expect(await getTopPool(OTHER)).toBeNull();
  });

  it("starts a >= 60s cooldown on 429 (GT sends retry-after: 0) and stops calling", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ status: { error_code: 429 } }), { status: 429, headers: { "retry-after": "0" } })
    );
    await expect(getTrades(POOL_A, SOL)).rejects.toBeInstanceOf(UpstreamError);
    expect(cooldownRemainingMs(GT_UPSTREAM)).toBeGreaterThanOrEqual(59_000);
    await expect(getTrades(POOL_A, SOL)).rejects.toMatchObject({ status: 503 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("caps keyless calls at the per-minute budget", async () => {
    fetchMock.mockImplementation(async () => json({ data: [] }));
    const results = await Promise.allSettled(Array.from({ length: 10 }, () => getTrades(POOL_A, SOL)));
    expect(fetchMock).toHaveBeenCalledTimes(gtConfig().perMinute);
    expect(results.filter((r) => r.status === "rejected")).toHaveLength(10 - gtConfig().perMinute);
  });

  it("wraps network errors and 5xx as UpstreamError", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("fetch failed"));
    await expect(getTrades(POOL_A, SOL)).rejects.toMatchObject({ status: 502 });
    fetchMock.mockResolvedValueOnce(json({}, 500));
    await expect(getTrades(POOL_A, SOL)).rejects.toMatchObject({ status: 502 });
  });
});
