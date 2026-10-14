// Server-only market data service: composes the Jupiter and GeckoTerminal
// providers behind the shared in-process cache. Routes call these functions;
// each returns the payload plus whether any part of it is stale, or throws an
// UpstreamError when nothing usable is cached.
import {
  cached,
  cachedMany,
  peek,
  UpstreamError,
  type CacheResult,
  type CachedManyResult,
} from "@/lib/server/cache";
import { CURATED_MARKETS, CURATED_MINTS, getCuratedMarket } from "./curated";
import { getCandles, getTopPool, getTrades, type GtPool } from "./geckoterminal";
import {
  fetchJupiterPrices,
  fetchJupiterTokenStats,
  PRICE_CHUNK,
  SEARCH_CHUNK,
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
  /** Prices of curated mints (the market list). */
  listPrice: 10,
  /** Stats of curated mints (the market list). */
  listStats: 60,
  detail: 15,
  tokenStats: 60,
  pool: 6 * 3600,
  /** A mint GT does not index yet may get a pool soon (new launches). */
  noPool: 30 * 60,
  candles: 60,
  trades: 60,
  /** Prices of any other mint (wallet holdings, searched tokens). */
  prices: 15,
  /** A mint Jupiter has no token entry for. */
  noStats: 5 * 60,
} as const;

/** Max age (s) of cached 1h candles reused for the detail's 24h high/low. */
const HIGH_LOW_MAX_AGE = 5 * 60;

const s = (seconds: number) => seconds * 1000;

export interface Served<T> {
  data: T;
  stale: boolean;
  /** Epoch ms when the payload's freshest-expiring part stops being fresh (for CDN headers). */
  expiresAt: number;
}

const CURATED_SET: ReadonlySet<string> = new Set(CURATED_MINTS);

// ---------------------------------------------------------------------------
// Cached building blocks

// Jupiter prices and stats are cached one entry per mint, so overlapping
// requests (wallets holding USDC, the list and a header) share entries, and a
// request only spends an upstream call on the mints that are missing or
// expired, all in one batched call. When a call is made anyway, the curated
// mints that are due ride along for free (calls are rate limited, not ids).

/** Prices for `mints` (<= 50 per call), per mint. */
function prices(mints: readonly string[]): Promise<CachedManyResult<JupiterPrice>> {
  return cachedMany(mints, (m) => `jup:price:${m}`, fetchJupiterPrices, {
    ttlMs: (_v, mint) => s(CURATED_SET.has(mint) ? TTL.listPrice : TTL.prices),
    maxBatch: PRICE_CHUNK,
    companions: CURATED_MINTS,
  });
}

/** Tokens v2 stats for `mints`, per mint; a mint Jupiter does not list is cached as null. */
function stats(mints: readonly string[]): Promise<CachedManyResult<JupiterTokenStats>> {
  return cachedMany(mints, (m) => `jup:stats:${m}`, fetchJupiterTokenStats, {
    ttlMs: (v, mint) => s(CURATED_SET.has(mint) ? TTL.listStats : v ? TTL.tokenStats : TTL.noStats),
    maxBatch: SEARCH_CHUNK,
    companions: CURATED_MINTS,
  });
}

/** The non-null values of `res` for `ids`, by mint. */
function valuesOf<T>(res: CachedManyResult<T>, ids: readonly string[]): Record<string, T> {
  const out: Record<string, T> = {};
  for (const id of ids) {
    const v = res.results.get(id)?.value;
    if (v !== undefined && v !== null) out[id] = v;
  }
  return out;
}

/** True when any of `ids` is missing from `res` or served stale. */
function anyStale<T>(res: CachedManyResult<T>, ids: readonly string[]): boolean {
  return ids.some((id) => {
    const r = res.results.get(id);
    return !r || r.stale;
  });
}

/** The results of `res` for `ids` that are present. */
function present<T>(res: CachedManyResult<T>, ids: readonly string[]): CacheResult<T | null>[] {
  return ids.flatMap((id) => {
    const r = res.results.get(id);
    return r ? [r] : [];
  });
}

/** An upstream failure to report when nothing usable was cached, keeping its Retry-After. */
function unavailable(message: string, ...errors: unknown[]): UpstreamError {
  const hints = errors
    .map((e) => (e instanceof UpstreamError ? e.retryAfterS : undefined))
    .filter((x): x is number => x !== undefined);
  return new UpstreamError(message, 503, hints.length ? Math.min(...hints) : undefined);
}

/** The GeckoTerminal pool for `mint`: hardcoded for curated mints, else resolved and cached. */
export async function resolvePool(mint: string): Promise<CacheResult<GtPool | null>> {
  const curated = getCuratedMarket(mint)?.pool;
  if (curated) {
    const now = Date.now();
    return { value: { ...curated, reserveUsd: 0 }, stale: false, fetchedAt: now, expiresAt: now + s(TTL.pool) };
  }
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
  const [p, st] = await Promise.all([prices(CURATED_MINTS), stats(CURATED_MINTS)]);
  const priceParts = present(p, CURATED_MINTS);
  const statParts = present(st, CURATED_MINTS);
  if (priceParts.length === 0 && statParts.length === 0) {
    throw unavailable("Market data unavailable", p.error, st.error);
  }
  const priceMap = valuesOf(p, CURATED_MINTS);
  const statMap = valuesOf(st, CURATED_MINTS);
  const markets = mergeMarkets(
    priceParts.length ? priceMap : null,
    statParts.length ? statMap : null
  );
  // A missing part is served as nulls (or the stats' own price) and flagged,
  // so the UI shows "delayed" instead of presenting partial data as live.
  const stale = anyStale(p, CURATED_MINTS) || anyStale(st, CURATED_MINTS);
  const updatedAt = Math.min(...(priceParts.length ? priceParts : statParts).map((r) => r.fetchedAt));
  const expiresAt = Math.min(...[...priceParts, ...statParts].map((r) => r.expiresAt));
  return { data: { markets, updatedAt }, stale, expiresAt };
}

/**
 * GET /api/market/prices. Mints already cached come from the cache; the rest
 * are fetched in one call. When that call fails, the mints with a recent value
 * are served stale and the others are absent (`stale: true`); it throws only
 * when nothing at all is available.
 */
export async function getPrices(
  ids: string[]
): Promise<Served<{ prices: Record<string, { usdPrice: number; change24hPct: number | null }>; updatedAt: number }>> {
  const res = await prices(ids);
  const parts = present(res, ids);
  if (parts.length === 0) throw unavailable("Prices unavailable", res.error);
  const out: Record<string, { usdPrice: number; change24hPct: number | null }> = {};
  for (const [id, p] of Object.entries(valuesOf(res, ids))) {
    out[id] = { usdPrice: p.usdPrice, change24hPct: p.change24hPct };
  }
  return {
    data: { prices: out, updatedAt: Math.min(...parts.map((r) => r.fetchedAt)) },
    stale: anyStale(res, ids),
    expiresAt: Math.min(...parts.map((r) => r.expiresAt)),
  };
}

/** GET /api/market/[mint] */
export async function getMarketDetail(mint: string, nowMs = Date.now()): Promise<Served<MarketDetail>> {
  const curated = getCuratedMarket(mint);
  const [statsAll, priceAll, poolRes] = await Promise.all([
    stats([mint]),
    prices([mint]),
    settle(resolvePool(mint)),
  ]);
  const statsRes = statsAll.results.get(mint) ?? null;
  const priceRes = priceAll.results.get(mint) ?? null;

  const st = statsRes?.value ?? null;
  if (!curated && !st) {
    if (statsRes) throw new UpstreamError("Unknown token", 404);
    throw unavailable("Token data unavailable", statsAll.error);
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
  const expiries = [priceRes?.expiresAt, statsRes?.expiresAt].filter((x): x is number => x !== undefined);
  const expiresAt = expiries.length ? Math.min(...expiries) : nowMs;
  return { data: detail, stale, expiresAt };
}

/** GET /api/market/[mint]/candles */
export async function getMarketCandles(mint: string, tf: Timeframe): Promise<Served<CandlesResponse>> {
  const poolRes = await resolvePool(mint);
  const pool = poolRes.value;
  if (!pool) {
    return {
      data: { mint, tf, pool: null, candles: [], updatedAt: poolRes.fetchedAt },
      stale: poolRes.stale,
      expiresAt: poolRes.expiresAt,
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
    expiresAt: Math.min(res.expiresAt, poolRes.expiresAt),
  };
}

/** GET /api/market/[mint]/trades */
export async function getMarketTrades(mint: string): Promise<Served<TradesResponse>> {
  const poolRes = await resolvePool(mint);
  const pool = poolRes.value;
  if (!pool) {
    return {
      data: { mint, pool: null, trades: [], updatedAt: poolRes.fetchedAt },
      stale: poolRes.stale,
      expiresAt: poolRes.expiresAt,
    };
  }
  const res = await poolTrades(pool.address, mint);
  return {
    data: { mint, pool: { address: pool.address, dex: pool.dex }, trades: res.value, updatedAt: res.fetchedAt },
    stale: res.stale || poolRes.stale,
    expiresAt: Math.min(res.expiresAt, poolRes.expiresAt),
  };
}
