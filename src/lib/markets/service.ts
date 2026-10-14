// Server-only market data service: composes the Jupiter and GeckoTerminal
// providers behind the shared in-process cache. Routes call these functions;
// each returns the payload plus whether any part of it is stale, or throws an
// UpstreamError when nothing usable is cached.
import { cached, peek, UpstreamError, type CacheResult } from "@/lib/server/cache";
import { CURATED_MARKETS, CURATED_MINTS, getCuratedMarket } from "./curated";
import { getCandles, getTopPool, getTrades, type GtPool } from "./geckoterminal";
import {
  fetchJupiterPrices,
  fetchJupiterTokenStats,
  type JupiterPrice,
  type JupiterTokenStats,
} from "./jupiter";
import type {
  Candle,
  CandlesResponse,
  MarketDetail,
  MarketsResponse,
  MarketSummary,
  MarketTrade,
  Timeframe,
  TradesResponse,
} from "./types";

/** Server TTLs in seconds; routes use the same values for s-maxage. */
export const TTL = {
  listPrice: 10,
  listStats: 60,
  detail: 15,
  tokenStats: 60,
  pool: 6 * 3600,
  /** A mint GT does not index yet may get a pool soon (new launches). */
  noPool: 30 * 60,
  candles: 60,
  trades: 60,
  prices: 15,
} as const;

/** Max age (s) of cached 1h candles reused for the detail's 24h high/low. */
const HIGH_LOW_MAX_AGE = 5 * 60;

const s = (seconds: number) => seconds * 1000;

export interface Served<T> {
  data: T;
  stale: boolean;
}

// ---------------------------------------------------------------------------
// Cached building blocks

function curatedPrices(): Promise<CacheResult<Record<string, JupiterPrice>>> {
  return cached("jup:price:curated", () => fetchJupiterPrices(CURATED_MINTS), {
    ttlMs: s(TTL.listPrice),
  });
}

function curatedStats(): Promise<CacheResult<Record<string, JupiterTokenStats>>> {
  return cached("jup:stats:curated", () => fetchJupiterTokenStats(CURATED_MINTS), {
    ttlMs: s(TTL.listStats),
  });
}

/** Prices for an arbitrary set of <= 50 mints, keyed by the sorted set. */
function pricesFor(mints: string[]): Promise<CacheResult<Record<string, JupiterPrice>>> {
  const ids = Array.from(new Set(mints)).sort();
  return cached(`jup:price:${ids.join(",")}`, () => fetchJupiterPrices(ids), {
    ttlMs: s(TTL.prices),
  });
}

function tokenStats(mint: string): Promise<CacheResult<JupiterTokenStats | null>> {
  return cached(
    `jup:stats:${mint}`,
    async () => (await fetchJupiterTokenStats([mint]))[mint] ?? null,
    { ttlMs: (v) => s(v ? TTL.tokenStats : 5 * 60) }
  );
}

/** The GeckoTerminal pool for `mint`: hardcoded for curated mints, else resolved and cached. */
export async function resolvePool(mint: string): Promise<CacheResult<GtPool | null>> {
  const curated = getCuratedMarket(mint)?.pool;
  if (curated) return { value: { ...curated, reserveUsd: 0 }, stale: false, fetchedAt: Date.now() };
  return cached(`gt:pool:${mint}`, () => getTopPool(mint), {
    ttlMs: (pool) => s(pool ? TTL.pool : TTL.noPool),
    maxStaleMs: s(24 * 3600),
  });
}

function candlesKey(pool: string, mint: string, tf: Timeframe): string {
  return `gt:candles:${pool}:${mint}:${tf}`;
}

function poolCandles(pool: string, mint: string, tf: Timeframe): Promise<CacheResult<Candle[]>> {
  return cached(candlesKey(pool, mint, tf), () => getCandles(pool, mint, tf), {
    ttlMs: s(TTL.candles),
  });
}

function poolTrades(pool: string, mint: string): Promise<CacheResult<MarketTrade[]>> {
  return cached(`gt:trades:${pool}:${mint}`, () => getTrades(pool, mint), {
    ttlMs: s(TTL.trades),
  });
}

// ---------------------------------------------------------------------------
// Pure merge helpers (unit tested)

/** Merges the curated list with Jupiter prices and stats, by mint. */
export function mergeMarkets(
  prices: Record<string, JupiterPrice> | null,
  stats: Record<string, JupiterTokenStats> | null
): MarketSummary[] {
  return CURATED_MARKETS.map((m) => {
    const p = prices?.[m.mint];
    const st = stats?.[m.mint];
    return {
      mint: m.mint,
      symbol: m.symbol,
      name: m.name,
      decimals: m.decimals,
      icon: m.icon,
      isVerified: st ? st.isVerified : true,
      tier: m.tier,
      priceUsd: p?.usdPrice ?? st?.usdPrice ?? null,
      change24hPct: p?.change24hPct ?? st?.change24hPct ?? null,
      volume24hUsd: st?.volume24hUsd ?? null,
      liquidityUsd: st?.liquidityUsd ?? null,
      mcapUsd: st?.mcapUsd ?? null,
    };
  });
}

/**
 * Rolling 24h high/low from ascending 1h candles: buckets starting within the
 * last 24 hours (the open bucket included). Null when there are none.
 */
export function highLow24h(candles: readonly Candle[], nowMs: number): { high: number; low: number } | null {
  const hour = 3600;
  const from = Math.floor(nowMs / 1000 / hour) * hour - 23 * hour;
  let high = -Infinity;
  let low = Infinity;
  for (const c of candles) {
    if (c.time < from) continue;
    if (c.high > high) high = c.high;
    if (c.low < low) low = c.low;
  }
  return Number.isFinite(high) && Number.isFinite(low) ? { high, low } : null;
}

async function settle<T>(p: Promise<T>): Promise<T | null> {
  try {
    return await p;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Route-level operations

/** GET /api/markets */
export async function getMarkets(): Promise<Served<MarketsResponse>> {
  const [prices, stats] = await Promise.all([settle(curatedPrices()), settle(curatedStats())]);
  if (!prices && !stats) {
    throw new UpstreamError("Market data unavailable", 503);
  }
  const markets = mergeMarkets(prices?.value ?? null, stats?.value ?? null);
  // A missing half is served as nulls (or stats' own price) and flagged, so
  // the UI shows "delayed" instead of presenting partial data as live.
  const stale = !prices || !stats || prices.stale || stats.stale;
  const updatedAt = prices?.fetchedAt ?? stats!.fetchedAt;
  return { data: { markets, updatedAt }, stale };
}

/** GET /api/market/prices */
export async function getPrices(
  ids: string[]
): Promise<Served<{ prices: Record<string, { usdPrice: number; change24hPct: number | null }>; updatedAt: number }>> {
  const curatedSet = new Set(CURATED_MINTS);
  const fromCurated = ids.filter((id) => curatedSet.has(id));
  const others = ids.filter((id) => !curatedSet.has(id));
  const [cur, rest] = await Promise.all([
    fromCurated.length ? curatedPrices() : null,
    others.length ? pricesFor(others) : null,
  ]);
  const prices: Record<string, { usdPrice: number; change24hPct: number | null }> = {};
  for (const id of ids) {
    const p = (curatedSet.has(id) ? cur : rest)?.value[id];
    if (p) prices[id] = { usdPrice: p.usdPrice, change24hPct: p.change24hPct };
  }
  const parts = [cur, rest].filter((x): x is CacheResult<Record<string, JupiterPrice>> => x !== null);
  return {
    data: { prices, updatedAt: Math.min(...parts.map((x) => x.fetchedAt)) },
    stale: parts.some((x) => x.stale),
  };
}

/** GET /api/market/[mint] */
export async function getMarketDetail(mint: string, nowMs = Date.now()): Promise<Served<MarketDetail>> {
  const curated = getCuratedMarket(mint);
  const [statsRes, priceRes, poolRes] = await Promise.all([
    settle(
      curated
        ? curatedStats().then((r) => ({ ...r, value: r.value[mint] ?? null }))
        : tokenStats(mint)
    ),
    settle(
      curated
        ? curatedPrices().then((r) => ({ ...r, value: r.value[mint] ?? null }))
        : pricesFor([mint]).then((r) => ({ ...r, value: r.value[mint] ?? null }))
    ),
    settle(resolvePool(mint)),
  ]);

  const st = statsRes?.value ?? null;
  if (!curated && !st) {
    if (statsRes) throw new UpstreamError("Unknown token", 404);
    throw new UpstreamError("Token data unavailable", 503);
  }

  const pool = poolRes?.value ?? null;
  let hl: { high: number; low: number } | null = null;
  if (pool) {
    // Shares the chart's 1h candle cache. A 24h range barely moves in a few
    // minutes, so a recent cached copy is reused instead of spending GT quota.
    const recent = peek<Candle[]>(candlesKey(pool.address, mint, "1h"), s(HIGH_LOW_MAX_AGE));
    const candles = recent ?? (await settle(poolCandles(pool.address, mint, "1h")));
    if (candles) hl = highLow24h(candles.value, nowMs);
  }

  const p = priceRes?.value ?? null;
  const detail: MarketDetail = {
    mint,
    symbol: curated?.symbol ?? st!.symbol,
    name: curated?.name ?? st!.name,
    decimals: curated?.decimals ?? st!.decimals,
    icon: curated?.icon ?? st?.icon,
    isVerified: st ? st.isVerified : true,
    tier: curated?.tier ?? "search",
    priceUsd: p?.usdPrice ?? st?.usdPrice ?? null,
    change24hPct: p?.change24hPct ?? st?.change24hPct ?? null,
    volume24hUsd: st?.volume24hUsd ?? null,
    liquidityUsd: st?.liquidityUsd ?? null,
    mcapUsd: st?.mcapUsd ?? null,
    holderCount: st?.holderCount ?? null,
    organicScoreLabel: st?.organicScoreLabel ?? null,
    tags: st?.tags ?? [],
    tokenProgram: st?.tokenProgram ?? curated?.tokenProgram ?? null,
    audit: st?.audit ?? null,
    high24hUsd: null,
    low24hUsd: null,
    pool: pool ? { address: pool.address, dex: pool.dex, quoteSymbol: pool.quoteSymbol } : null,
    updatedAt: priceRes?.fetchedAt ?? statsRes?.fetchedAt ?? nowMs,
  };
  if (hl) {
    // The candles may be a few minutes old: keep the live price inside the range.
    const live = detail.priceUsd;
    detail.high24hUsd = live !== null ? Math.max(hl.high, live) : hl.high;
    detail.low24hUsd = live !== null ? Math.min(hl.low, live) : hl.low;
  }
  const stale = !priceRes || !statsRes || priceRes.stale || statsRes.stale;
  return { data: detail, stale };
}

/** GET /api/market/[mint]/candles */
export async function getMarketCandles(mint: string, tf: Timeframe): Promise<Served<CandlesResponse>> {
  const poolRes = await resolvePool(mint);
  const pool = poolRes.value;
  if (!pool) {
    return {
      data: { mint, tf, pool: null, candles: [], updatedAt: poolRes.fetchedAt },
      stale: poolRes.stale,
    };
  }
  const res = await poolCandles(pool.address, mint, tf);
  return {
    data: {
      mint,
      tf,
      pool: { address: pool.address, dex: pool.dex },
      candles: res.value,
      updatedAt: res.fetchedAt,
    },
    stale: res.stale || poolRes.stale,
  };
}

/** GET /api/market/[mint]/trades */
export async function getMarketTrades(mint: string): Promise<Served<TradesResponse>> {
  const poolRes = await resolvePool(mint);
  const pool = poolRes.value;
  if (!pool) {
    return { data: { mint, pool: null, trades: [], updatedAt: poolRes.fetchedAt }, stale: poolRes.stale };
  }
  const res = await poolTrades(pool.address, mint);
  return {
    data: { mint, pool: { address: pool.address, dex: pool.dex }, trades: res.value, updatedAt: res.fetchedAt },
    stale: res.stale || poolRes.stale,
  };
}
