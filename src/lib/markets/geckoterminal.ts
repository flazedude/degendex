// Server-only GeckoTerminal provider: pool discovery, OHLCV candles, trades.
//
// With CG_DEMO_API_KEY set we use CoinGecko's onchain API (same paths and
// shapes, 100 calls/min). Otherwise keyless GeckoTerminal (~10 calls/min per
// egress IP). Keyless api.coingecko.com is never used: it returns 401.
//
// Everything is parsed loosely: malformed rows are dropped, never thrown on.
import { isValidPubkey } from "@/lib/jupiter/params";
import { readJson } from "@/lib/jupiter/server";
import { SOL_MINT, USDC_MINT, USDT_MINT } from "@/lib/constants";
import { acquireUpstream, setCooldown, UpstreamError } from "@/lib/server/cache";
import type { Candle, MarketTrade, Timeframe } from "./types";

export const GT_UPSTREAM = "geckoterminal";
/** GT's 429 carries "retry-after: 0"; back off at least a minute ourselves. */
export const GT_COOLDOWN_S = 60;
export const CANDLE_LIMIT = 300;
/** Trades below this USD size are dust and are filtered upstream. */
export const MIN_TRADE_USD = 5;
const TIMEOUT_MS = 8_000;
const MIN_QUALIFYING_RESERVE_USD = 10_000;

const KEYLESS_BASE = "https://api.geckoterminal.com/api/v2";
const DEMO_BASE = "https://api.coingecko.com/api/v3/onchain";

export interface GtConfig {
  baseUrl: string;
  headers: Record<string, string>;
  /** Our share of the upstream limit, in calls per minute. */
  perMinute: number;
}

export function gtConfig(): GtConfig {
  const key = process.env.CG_DEMO_API_KEY?.trim();
  if (key) {
    return {
      baseUrl: DEMO_BASE,
      headers: { Accept: "application/json", "x-cg-demo-api-key": key },
      perMinute: 80,
    };
  }
  return {
    baseUrl: KEYLESS_BASE,
    headers: { Accept: "application/json;version=20230203" },
    perMinute: 8,
  };
}

export const TIMEFRAME_PARAMS: Record<Timeframe, { timeframe: "minute" | "hour" | "day"; aggregate: number }> = {
  "1m": { timeframe: "minute", aggregate: 1 },
  "5m": { timeframe: "minute", aggregate: 5 },
  "15m": { timeframe: "minute", aggregate: 15 },
  "1h": { timeframe: "hour", aggregate: 1 },
  "4h": { timeframe: "hour", aggregate: 4 },
  "1d": { timeframe: "day", aggregate: 1 },
};

/** Quote assets a pool should be paired with to give a meaningful USD chart. */
const PREFERRED_QUOTES: Record<string, string> = {
  [USDC_MINT]: "USDC",
  [USDT_MINT]: "USDT",
  [SOL_MINT]: "SOL",
};

export interface GtPool {
  address: string;
  dex: string;
  /** Symbol of the pool's other side (the asset our token is paired with). */
  quoteSymbol: string;
  reserveUsd: number;
}

interface PoolCandidate extends GtPool {
  otherMint: string;
}

function num(v: unknown): number | null {
  if (typeof v !== "number" && typeof v !== "string") return null;
  if (typeof v === "string" && v.trim() === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function obj(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

/** "solana_<address>" -> "<address>" (null if it is not a valid address). */
function relAddress(rel: unknown): string | null {
  const id = obj(obj(rel)?.data)?.id;
  if (typeof id !== "string") return null;
  const address = id.startsWith("solana_") ? id.slice("solana_".length) : id;
  return isValidPubkey(address) ? address : null;
}

function symbolFromName(name: unknown, tokenIsBase: boolean): string | null {
  if (typeof name !== "string") return null;
  const parts = name.split(" / ");
  if (parts.length !== 2) return null;
  const side = (tokenIsBase ? parts[1] : parts[0]).trim().split(/\s+/)[0];
  return side ? side.slice(0, 16) : null;
}

/** Parses a /tokens/{mint}/pools body into pools that contain `mint`. */
export function parsePools(body: unknown, mint: string): PoolCandidate[] {
  const data = obj(body)?.data;
  if (!Array.isArray(data)) return [];
  const out: PoolCandidate[] = [];
  for (const row of data) {
    const r = obj(row);
    const attrs = obj(r?.attributes);
    const rels = obj(r?.relationships);
    if (!attrs || !rels) continue;
    const address = attrs.address;
    if (!isValidPubkey(address)) continue;
    const base = relAddress(rels.base_token);
    const quote = relAddress(rels.quote_token);
    if (!base || !quote) continue;
    let tokenIsBase: boolean;
    if (base === mint) tokenIsBase = true;
    else if (quote === mint) tokenIsBase = false;
    else continue;
    const otherMint = tokenIsBase ? quote : base;
    const reserve = num(attrs.reserve_in_usd);
    const dexId = obj(obj(rels.dex)?.data)?.id;
    out.push({
      address,
      dex: typeof dexId === "string" && dexId ? dexId.slice(0, 32) : "unknown",
      quoteSymbol: PREFERRED_QUOTES[otherMint] ?? symbolFromName(attrs.name, tokenIsBase) ?? "?",
      reserveUsd: reserve !== null && reserve > 0 ? reserve : 0,
      otherMint,
    });
  }
  return out;
}

/**
 * The pool to chart: highest reserve among pools paired with USDC, USDT or
 * SOL holding at least $10k; otherwise the highest reserve overall. Ranking
 * by volume would pick wash-traded pools, so reserve it is.
 */
export function selectTopPool(candidates: readonly PoolCandidate[]): GtPool | null {
  const byReserve = (a: PoolCandidate, b: PoolCandidate) => b.reserveUsd - a.reserveUsd;
  const preferred = candidates
    .filter((p) => p.otherMint in PREFERRED_QUOTES && p.reserveUsd >= MIN_QUALIFYING_RESERVE_USD)
    .sort(byReserve);
  const pick = preferred[0] ?? [...candidates].sort(byReserve)[0];
  if (!pick) return null;
  return { address: pick.address, dex: pick.dex, quoteSymbol: pick.quoteSymbol, reserveUsd: pick.reserveUsd };
}

/**
 * Parses an OHLCV body ([ts, o, h, l, c, volUsd] rows, newest first) into
 * ascending candles with unique times. Malformed rows are dropped.
 */
export function parseOhlcv(body: unknown): Candle[] {
  const list = obj(obj(obj(body)?.data)?.attributes)?.ohlcv_list;
  if (!Array.isArray(list)) return [];
  const byTime = new Map<number, Candle>();
  for (const row of list) {
    if (!Array.isArray(row) || row.length < 6) continue;
    const [t, o, h, l, c, v] = row.slice(0, 6).map(num);
    if (t === null || !Number.isInteger(t) || t <= 0) continue;
    if (o === null || h === null || l === null || c === null) continue;
    if (o <= 0 || h <= 0 || l <= 0 || c <= 0) continue;
    // Newest-first input: the first row seen for a time is the most recent one.
    if (byTime.has(t)) continue;
    byTime.set(t, {
      time: t,
      open: o,
      high: Math.max(h, o, c),
      low: Math.min(l, o, c),
      close: c,
      volume: v !== null && v > 0 ? v : 0,
    });
  }
  return Array.from(byTime.values()).sort((a, b) => a.time - b.time);
}

/**
 * Parses a pool trades body fetched with token=<mint>. Side, price and amount
 * are taken from whichever leg is `mint`; rows where neither leg is `mint`
 * are dropped. Returned newest first, deduped by id.
 */
export function parseTrades(body: unknown, mint: string): MarketTrade[] {
  const data = obj(body)?.data;
  if (!Array.isArray(data)) return [];
  const seen = new Set<string>();
  const out: MarketTrade[] = [];
  for (const row of data) {
    const r = obj(row);
    const a = obj(r?.attributes);
    if (!r || !a) continue;
    const txHash = a.tx_hash;
    if (typeof txHash !== "string" || !/^[1-9A-HJ-NP-Za-km-z]{32,90}$/.test(txHash)) continue;
    const id = typeof r.id === "string" && r.id ? r.id.slice(0, 160) : txHash;
    if (seen.has(id)) continue;
    let side: "buy" | "sell";
    let price: number | null;
    let amount: number | null;
    if (a.to_token_address === mint) {
      side = "buy";
      price = num(a.price_to_in_usd);
      amount = num(a.to_token_amount);
    } else if (a.from_token_address === mint) {
      side = "sell";
      price = num(a.price_from_in_usd);
      amount = num(a.from_token_amount);
    } else {
      continue;
    }
    const volume = num(a.volume_in_usd);
    const ts = typeof a.block_timestamp === "string" ? Date.parse(a.block_timestamp) : NaN;
    if (price === null || price <= 0 || amount === null || amount <= 0) continue;
    if (volume === null || volume < 0 || !Number.isFinite(ts)) continue;
    seen.add(id);
    const trade: MarketTrade = { id, ts, side, priceUsd: price, amount, volumeUsd: volume, txHash };
    if (isValidPubkey(a.tx_from_address)) trade.wallet = a.tx_from_address;
    out.push(trade);
  }
  return out.sort((x, y) => y.ts - x.ts);
}

/** GET from GeckoTerminal; resolves null on 404 (unknown token or pool). */
async function gtGet(path: string, params: Record<string, string> = {}): Promise<unknown | null> {
  const config = gtConfig();
  acquireUpstream(GT_UPSTREAM, config.perMinute);
  const qs = new URLSearchParams(params).toString();
  let res: Response;
  try {
    res = await fetch(`${config.baseUrl}${path}${qs ? `?${qs}` : ""}`, {
      headers: config.headers,
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    throw new UpstreamError("Could not reach GeckoTerminal", 502);
  }
  if (res.status === 429) {
    setCooldown(GT_UPSTREAM, GT_COOLDOWN_S);
    throw new UpstreamError("Rate limited by GeckoTerminal", 503, GT_COOLDOWN_S);
  }
  if (res.status === 404) {
    await res.body?.cancel().catch(() => {});
    return null;
  }
  const body = await readJson(res);
  if (!res.ok || body === null) {
    throw new UpstreamError(`GeckoTerminal error (${res.status})`, 502);
  }
  return body;
}

/** The pool to chart for `mint`, or null when GT does not index it. */
export async function getTopPool(mint: string): Promise<GtPool | null> {
  const body = await gtGet(`/networks/solana/tokens/${mint}/pools`);
  if (body === null) return null;
  return selectTopPool(parsePools(body, mint));
}

/** Up to 300 ascending USD candles of `mint` in `pool` (either side of the pool). */
export async function getCandles(pool: string, mint: string, tf: Timeframe): Promise<Candle[]> {
  const { timeframe, aggregate } = TIMEFRAME_PARAMS[tf];
  const body = await gtGet(`/networks/solana/pools/${pool}/ohlcv/${timeframe}`, {
    aggregate: String(aggregate),
    limit: String(CANDLE_LIMIT),
    currency: "usd",
    token: mint,
  });
  return body === null ? [] : parseOhlcv(body);
}

/** The pool's last (up to 300, within 24h) trades of `mint`, newest first. */
export async function getTrades(pool: string, mint: string): Promise<MarketTrade[]> {
  const body = await gtGet(`/networks/solana/pools/${pool}/trades`, {
    trade_volume_in_usd_greater_than: String(MIN_TRADE_USD),
    token: mint,
  });
  return body === null ? [] : parseTrades(body, mint);
}
