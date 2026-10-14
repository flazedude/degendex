import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cooldownRemainingMs, resetServerCache } from "@/lib/server/cache";
import {
  fetchJupiterPrices,
  fetchJupiterTokenStats,
  JUPITER_UPSTREAM,
  parsePriceV3,
  parseTokenSearch,
  parseTokenStats,
} from "./jupiter";
import { CURATED_MINTS } from "./curated";

const SOL = "So11111111111111111111111111111111111111112";
const JUP = "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN";
const BONK = "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263";

const fetchMock = vi.fn();
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

beforeEach(() => {
  resetServerCache();
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  vi.stubEnv("JUPITER_API_KEY", "key");
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

const jupToken = {
  id: JUP,
  name: "Jupiter",
  symbol: "JUP",
  icon: "https://static.jup.ag/jup/icon.png",
  decimals: 6,
  tokenProgram: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
  holderCount: 838623,
  audit: { mintAuthorityDisabled: true, freezeAuthorityDisabled: true, topHoldersPercentage: 15.5 },
  organicScoreLabel: "high",
  isVerified: true,
  tags: ["verified", 3, "strict"],
  mcap: 1093304203,
  usdPrice: 0.329495,
  liquidity: 5559201,
  stats24h: { priceChange: -2.07, buyVolume: 4_300_000, sellVolume: 4_300_000.5 },
};

describe("parsePriceV3", () => {
  it("merges by mint, keeps only requested mints and skips missing ones", () => {
    const body = {
      [BONK]: { usdPrice: 0.00000320568054330824, priceChange24h: -2.285 },
      [SOL]: { usdPrice: 107.04, priceChange24h: null },
      [JUP]: { usdPrice: "bad" },
      Unrequested111111111111111111111111111111111: { usdPrice: 1 },
    };
    expect(parsePriceV3(body, [SOL, BONK, JUP, "missing"])).toEqual({
      [SOL]: { usdPrice: 107.04, change24hPct: null },
      [BONK]: { usdPrice: 0.00000320568054330824, change24hPct: -2.285 },
    });
  });

  it("ignores non-object bodies and prototype keys", () => {
    expect(parsePriceV3(null, [SOL])).toEqual({});
    expect(parsePriceV3([1, 2], [SOL])).toEqual({});
    expect(parsePriceV3({}, ["__proto__", "constructor"])).toEqual({});
  });
});

describe("parseTokenStats", () => {
  it("maps a Tokens v2 element", () => {
    expect(parseTokenStats(jupToken)).toEqual({
      mint: JUP,
      symbol: "JUP",
      name: "Jupiter",
      decimals: 6,
      icon: "https://static.jup.ag/jup/icon.png",
      isVerified: true,
      tokenProgram: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
      holderCount: 838623,
      organicScoreLabel: "high",
      tags: ["verified", "strict"],
      audit: { mintAuthorityDisabled: true, freezeAuthorityDisabled: true, topHoldersPercentage: 15.5 },
      usdPrice: 0.329495,
      change24hPct: -2.07,
      volume24hUsd: 8_600_000.5,
      liquidityUsd: 5559201,
      mcapUsd: 1093304203,
    });
  });

  it("treats isVerified null as unverified and tolerates missing stats", () => {
    const t = parseTokenStats({ id: BONK, symbol: "BONK", decimals: 5, isVerified: null, icon: "http://x" });
    expect(t).toMatchObject({
      isVerified: false,
      icon: undefined,
      volume24hUsd: null,
      change24hPct: null,
      audit: null,
      holderCount: null,
      tags: [],
      name: "BONK",
    });
  });

  it("rejects unusable elements", () => {
    expect(parseTokenStats(null)).toBeNull();
    expect(parseTokenStats({ id: "nope", symbol: "X", decimals: 6 })).toBeNull();
    expect(parseTokenStats({ id: JUP, symbol: "X", decimals: 6.5 })).toBeNull();
    expect(parseTokenStats({ id: JUP, decimals: 6 })).toBeNull();
  });

  it("parseTokenSearch keys by mint and keeps the first duplicate", () => {
    const out = parseTokenSearch([jupToken, { ...jupToken, symbol: "DUP" }, null, "x"]);
    expect(Object.keys(out)).toEqual([JUP]);
    expect(out[JUP].symbol).toBe("JUP");
    expect(parseTokenSearch({})).toEqual({});
  });
});

describe("fetchJupiterPrices", () => {
  it("sends the api key, dedupes ids and merges out-of-order results by mint", async () => {
    fetchMock.mockImplementation(async (url: string) => {
      const requested = new URL(url).searchParams.get("ids")!.split(",");
      const body: Record<string, unknown> = {};
      for (const id of [...requested].reverse()) body[id] = { usdPrice: id.length, priceChange24h: 0 };
      return json(body);
    });
    const out = await fetchJupiterPrices([...CURATED_MINTS, SOL, SOL]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    const u = new URL(url);
    expect(u.origin + u.pathname).toBe("https://api.jup.ag/price/v3");
    expect(u.searchParams.get("ids")!.split(",")).toEqual([...CURATED_MINTS]);
    expect(init.headers["x-api-key"]).toBe("key");
    expect(Object.keys(out).sort()).toEqual([...CURATED_MINTS].sort());
    for (const mint of CURATED_MINTS) expect(out[mint].usdPrice).toBe(mint.length);
  });

  it("splits 120 unique ids into 3 calls", async () => {
    const ids = Array.from({ length: 120 }, (_, i) => `${"1".repeat(31)}${"ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"[i % 49]}${i}`);
    fetchMock.mockImplementation(async () => json({}));
    await fetchJupiterPrices(ids);
    expect(fetchMock.mock.calls.map(([u]) => new URL(u).searchParams.get("ids")!.split(",").length)).toEqual([
      50, 50, 20,
    ]);
  });

  it("starts a cooldown from x-ratelimit-reset on 429", async () => {
    const reset = Math.ceil(Date.now() / 1000) + 8;
    fetchMock.mockResolvedValue(json({}, 429, { "x-ratelimit-reset": String(reset) }));
    await expect(fetchJupiterPrices([SOL])).rejects.toMatchObject({ status: 503 });
    expect(cooldownRemainingMs(JUPITER_UPSTREAM)).toBeGreaterThan(5_000);
    await expect(fetchJupiterPrices([SOL])).rejects.toMatchObject({ status: 503 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("fetchJupiterTokenStats", () => {
  it("calls tokens v2 search with comma-separated mints and keeps only requested ones", async () => {
    fetchMock.mockResolvedValue(json([jupToken, { ...jupToken, id: BONK, symbol: "Bonk", decimals: 5 }]));
    const out = await fetchJupiterTokenStats([JUP]);
    const u = new URL(fetchMock.mock.calls[0][0]);
    expect(u.pathname).toBe("/tokens/v2/search");
    expect(u.searchParams.get("query")).toBe(JUP);
    expect(Object.keys(out)).toEqual([JUP]);
  });

  it("surfaces upstream errors", async () => {
    fetchMock.mockResolvedValue(json({ error: "boom" }, 500));
    await expect(fetchJupiterTokenStats([JUP])).rejects.toMatchObject({ status: 502, message: "boom" });
  });
});
