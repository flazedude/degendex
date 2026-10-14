// Server-only Jupiter market data: Price v3 and Tokens v2 search, batched.
// Never import from client code (jupiterHeaders reads JUPITER_API_KEY).
import { isValidPubkey } from "@/lib/jupiter/params";
import {
  JUPITER_BASE_URL,
  jupiterHeaders,
  readJson,
  retryAfterSeconds,
  upstreamError,
} from "@/lib/jupiter/server";
import { acquireUpstream, setCooldown, UpstreamError } from "@/lib/server/cache";

/** Price v3 silently drops ids past the 50th (verified live). */
export const PRICE_CHUNK = 50;
/** Tokens v2 search accepts up to 100 comma-separated mints. */
export const SEARCH_CHUNK = 100;
const TIMEOUT_MS = 8_000;

export const JUPITER_UPSTREAM = "jupiter";

/**
 * Calls per minute market data may spend from the org-wide Jupiter bucket,
 * leaving headroom for swaps (/order). Keyless is 30/min in total; a key
 * gets at least 60/min.
 */
export function jupiterBudgetPerMinute(): number {
  return process.env.JUPITER_API_KEY?.trim() ? 40 : 15;
}

export interface JupiterPrice {
  usdPrice: number;
  /** Percent (1.5 = +1.5%), null when Jupiter has none. */
  change24hPct: number | null;
}

export interface JupiterTokenStats {
  mint: string;
  symbol: string;
  name: string;
  decimals: number;
  icon?: string;
  isVerified: boolean;
  tokenProgram: string | null;
  holderCount: number | null;
  organicScoreLabel: string | null;
  tags: string[];
  audit: {
    mintAuthorityDisabled?: boolean;
    freezeAuthorityDisabled?: boolean;
    topHoldersPercentage?: number;
  } | null;
  usdPrice: number | null;
  change24hPct: number | null;
  volume24hUsd: number | null;
  liquidityUsd: number | null;
  mcapUsd: number | null;
}

function finite(v: unknown): number | null {
  if (typeof v !== "number" && typeof v !== "string") return null;
  if (typeof v === "string" && v.trim() === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function nonNegative(v: unknown): number | null {
  const n = finite(v);
  return n !== null && n >= 0 ? n : null;
}

function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * Parses a Price v3 body (an object keyed by mint). Only `requested` mints are
 * kept: results are merged by mint, never by position. Mints Jupiter has no
 * reliable price for are simply absent.
 */
export function parsePriceV3(
  body: unknown,
  requested: readonly string[]
): Record<string, JupiterPrice> {
  const out: Record<string, JupiterPrice> = {};
  if (!body || typeof body !== "object" || Array.isArray(body)) return out;
  const map = body as Record<string, unknown>;
  for (const mint of requested) {
    const item = Object.prototype.hasOwnProperty.call(map, mint) ? map[mint] : undefined;
    if (!item || typeof item !== "object") continue;
    const { usdPrice, priceChange24h } = item as Record<string, unknown>;
    const price = finite(usdPrice);
    if (price === null || price <= 0) continue;
    out[mint] = { usdPrice: price, change24hPct: finite(priceChange24h) };
  }
  return out;
}

/** Parses one Tokens v2 search element, or null if it is unusable. */
export function parseTokenStats(raw: unknown): JupiterTokenStats | null {
  if (!raw || typeof raw !== "object") return null;
  const t = raw as Record<string, unknown>;
  if (!isValidPubkey(t.id) || typeof t.symbol !== "string") return null;
  const decimals = t.decimals;
  if (typeof decimals !== "number" || !Number.isInteger(decimals) || decimals < 0 || decimals > 255) {
    return null;
  }
  const stats = t.stats24h && typeof t.stats24h === "object" ? (t.stats24h as Record<string, unknown>) : null;
  const buy = nonNegative(stats?.buyVolume);
  const sell = nonNegative(stats?.sellVolume);
  let audit: JupiterTokenStats["audit"] = null;
  if (t.audit && typeof t.audit === "object") {
    const a = t.audit as Record<string, unknown>;
    audit = {};
    if (typeof a.mintAuthorityDisabled === "boolean") audit.mintAuthorityDisabled = a.mintAuthorityDisabled;
    if (typeof a.freezeAuthorityDisabled === "boolean") audit.freezeAuthorityDisabled = a.freezeAuthorityDisabled;
    const top = finite(a.topHoldersPercentage);
    if (top !== null) audit.topHoldersPercentage = top;
  }
  const holders = nonNegative(t.holderCount);
  const price = finite(t.usdPrice);
  return {
    mint: t.id,
    symbol: t.symbol.slice(0, 24) || "?",
    name: typeof t.name === "string" && t.name ? t.name.slice(0, 64) : t.symbol.slice(0, 24),
    decimals,
    icon: typeof t.icon === "string" && /^https:\/\//.test(t.icon) ? t.icon : undefined,
    // isVerified is null (not false) for unverified tokens.
    isVerified: t.isVerified === true,
    tokenProgram: isValidPubkey(t.tokenProgram) ? t.tokenProgram : null,
    holderCount: holders !== null ? Math.round(holders) : null,
    organicScoreLabel:
      typeof t.organicScoreLabel === "string" && t.organicScoreLabel ? t.organicScoreLabel.slice(0, 16) : null,
    tags: Array.isArray(t.tags)
      ? t.tags.filter((x): x is string => typeof x === "string").slice(0, 20)
      : [],
    audit,
    usdPrice: price !== null && price > 0 ? price : null,
    change24hPct: finite(stats?.priceChange),
    volume24hUsd: buy !== null && sell !== null ? buy + sell : null,
    liquidityUsd: nonNegative(t.liquidity),
    mcapUsd: nonNegative(t.mcap),
  };
}

/** Parses a Tokens v2 search array into a map keyed by mint. */
export function parseTokenSearch(body: unknown): Record<string, JupiterTokenStats> {
  const out: Record<string, JupiterTokenStats> = {};
  if (!Array.isArray(body)) return out;
  for (const raw of body) {
    const t = parseTokenStats(raw);
    if (t && !out[t.mint]) out[t.mint] = t;
  }
  return out;
}

async function jupiterGet(path: string, params: Record<string, string>): Promise<unknown> {
  acquireUpstream(JUPITER_UPSTREAM, jupiterBudgetPerMinute());
  let res: Response;
  try {
    res = await fetch(`${JUPITER_BASE_URL}${path}?${new URLSearchParams(params)}`, {
      headers: jupiterHeaders(),
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    throw new UpstreamError("Could not reach Jupiter", 502);
  }
  if (res.status === 429) {
    const seconds = retryAfterSeconds(res.headers);
    setCooldown(JUPITER_UPSTREAM, seconds);
    throw new UpstreamError("Rate limited by Jupiter", 503, seconds);
  }
  const body = await readJson(res);
  if (!res.ok) {
    throw new UpstreamError(upstreamError(body, `Jupiter error (${res.status})`), 502);
  }
  return body;
}

/** USD prices for `mints` (deduped), in chunks of <= 50 ids, merged by mint. */
export async function fetchJupiterPrices(mints: readonly string[]): Promise<Record<string, JupiterPrice>> {
  const unique = Array.from(new Set(mints));
  const parts = await Promise.all(
    chunk(unique, PRICE_CHUNK).map(async (ids) =>
      parsePriceV3(await jupiterGet("/price/v3", { ids: ids.join(",") }), ids)
    )
  );
  return Object.assign({}, ...parts);
}

/** Token metadata and 24h stats for `mints`, in chunks of <= 100, merged by mint. */
export async function fetchJupiterTokenStats(
  mints: readonly string[]
): Promise<Record<string, JupiterTokenStats>> {
  const unique = Array.from(new Set(mints));
  const parts = await Promise.all(
    chunk(unique, SEARCH_CHUNK).map(async (ids) => {
      const all = parseTokenSearch(await jupiterGet("/tokens/v2/search", { query: ids.join(",") }));
      const wanted: Record<string, JupiterTokenStats> = {};
      for (const id of ids) if (all[id]) wanted[id] = all[id];
      return wanted;
    })
  );
  return Object.assign({}, ...parts);
}
