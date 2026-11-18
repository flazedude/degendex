import { afterEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { MAX_PRICE_IDS } from "@/lib/markets/validate";
import {
  mergePriceParts,
  pricesStale,
  selectPrices,
  selectServerStale,
  tokenPricesQuery,
  withStale,
} from "./useTokenPrices";

const SOL = "So11111111111111111111111111111111111111112";
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("mergePriceParts", () => {
  it("merges chunks by mint, keeps only requested numeric prices and ORs stale", () => {
    const out = mergePriceParts(
      [SOL, USDC],
      [
        { prices: { [SOL]: { usdPrice: 100, change24hPct: 1 } } },
        {
          prices: { [USDC]: { usdPrice: 1, change24hPct: null }, other: { usdPrice: 5, change24hPct: null } },
          stale: true,
        },
      ]
    );
    expect(out).toEqual({
      prices: { [SOL]: { usdPrice: 100, change24hPct: 1 }, [USDC]: { usdPrice: 1, change24hPct: null } },
      stale: true,
    });
    expect(mergePriceParts([SOL], [{ prices: {} }, {}]).stale).toBe(false);
  });
});

describe("pricesStale", () => {
  it("is true when the server said so or the last refetch failed", () => {
    expect(pricesStale(undefined, false)).toBe(false);
    expect(pricesStale(false, false)).toBe(false);
    expect(pricesStale(true, false)).toBe(true);
    expect(pricesStale(false, true)).toBe(true);
  });
});

describe("withStale", () => {
  it("adds stale without copying or hiding the query's fields", () => {
    const reads: PropertyKey[] = [];
    const query = new Proxy({ data: 1, isError: false }, {
      get: (t, k) => {
        reads.push(k);
        return Reflect.get(t, k);
      },
    });
    const out = withStale(query, true);
    expect(out.stale).toBe(true);
    expect("stale" in out).toBe(true);
    // Only the fields actually read reach the tracked query.
    expect(out.data).toBe(1);
    expect(reads).toEqual(["data"]);
    expect({ ...out }).toEqual({ data: 1, isError: false, stale: true });
  });
});

describe("tokenPricesQuery with a disabled stale observer", () => {
  it("fetches once and exposes both the prices and the server's stale flag", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ prices: { [SOL]: { usdPrice: 100, change24hPct: 1 } }, stale: true }), {
        status: 200,
      })
    );
    vi.stubGlobal("fetch", fetchMock);
    const client = new QueryClient();
    const base = tokenPricesQuery([SOL]);
    const prices = new QueryObserver(client, { ...base, select: selectPrices });
    const stale = new QueryObserver(client, { ...base, enabled: false, select: selectServerStale });
    const unsubs = [prices.subscribe(() => {}), stale.subscribe(() => {})];
    await vi.waitFor(() => expect(prices.getCurrentResult().isSuccess).toBe(true));
    expect(prices.getCurrentResult().data).toEqual({ [SOL]: { usdPrice: 100, change24hPct: 1 } });
    expect(stale.getCurrentResult().data).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String((fetchMock.mock.calls[0] as unknown[])[0])).toContain(`/api/market/prices?ids=${SOL}`);
    unsubs.forEach((u) => u());
    client.clear();
  });
});

describe("tokenPricesQuery when some prices are unavailable", () => {
  it("shows prices from successful chunks and marks them as incomplete", async () => {
    const fillers = Array.from({ length: MAX_PRICE_IDS - 1 }, (_, index) => `mint-${index}`);
    const fetchMock = vi.fn(async (url: string) =>
      url.includes(USDC)
        ? Response.json({ error: "Price temporarily unavailable" }, { status: 503 })
        : Response.json({ prices: { [SOL]: { usdPrice: 100, change24hPct: 1 } } })
    );
    vi.stubGlobal("fetch", fetchMock);
    const client = new QueryClient();
    try {
      const result = await client.fetchQuery(tokenPricesQuery([SOL, ...fillers, USDC]));
      expect(result).toEqual({
        prices: { [SOL]: { usdPrice: 100, change24hPct: 1 } },
        stale: true,
      });
      expect(fetchMock).toHaveBeenCalledTimes(2);
    } finally {
      client.clear();
    }
  });

  it("keeps an error when every chunk fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async () =>
      Response.json({ error: "Price temporarily unavailable" }, { status: 503 })
    ));
    const client = new QueryClient();
    try {
      await expect(client.fetchQuery({ ...tokenPricesQuery([SOL]), retry: false }))
        .rejects.toMatchObject({ status: 503 });
    } finally {
      client.clear();
    }
  });
});
