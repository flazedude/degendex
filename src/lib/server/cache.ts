// Server-only, in-process cache for upstream market data.
//
// Every visitor of the site shares one Jupiter rate-limit bucket (per org) and
// one GeckoTerminal quota (per egress IP), so upstream calls must not scale with
// traffic. This module provides:
// - a TTL cache with single-flight: concurrent callers for the same key share
//   one in-flight upstream Promise;
// - stale-on-error: when a refresh fails, the last good value is served marked
//   `stale` (up to `maxStaleMs`), so the UI can show a "delayed" badge;
// - a bounded size with least-recently-used eviction;
// - per-upstream cooldowns (after a 429) and a per-minute call budget, checked
//   with acquireUpstream() before every upstream request.
//
// State lives in module-level Maps, which persist across requests within one
// Next.js server process (one per serverless instance on Vercel).

export class UpstreamError extends Error {
  readonly status: number;
  /** Seconds the client should wait before retrying, when known. */
  readonly retryAfterS?: number;

  constructor(message: string, status = 502, retryAfterS?: number) {
    super(message);
    this.name = "UpstreamError";
    this.status = status;
    this.retryAfterS = retryAfterS;
  }
}

export interface CacheResult<T> {
  value: T;
  /** True when the refresh failed and this is an older value. */
  stale: boolean;
  /** Epoch ms when `value` was fetched from upstream. */
  fetchedAt: number;
}

export interface CachedOptions<T> {
  /** Fresh lifetime in ms; a function lets e.g. negative results expire sooner. */
  ttlMs: number | ((value: T) => number);
  /** How old a value may be and still be served stale after an error. Default 10 min. */
  maxStaleMs?: number;
}

interface Entry {
  value: unknown;
  fetchedAt: number;
  expiresAt: number;
  maxStaleMs: number;
}

const DEFAULT_MAX_STALE_MS = 10 * 60_000;
const MAX_ENTRIES = 1000;

const entries = new Map<string, Entry>();
const inflight = new Map<string, Promise<CacheResult<unknown>>>();

function touch(key: string, entry: Entry): void {
  // Map iteration order is insertion order: re-inserting marks it most recent.
  entries.delete(key);
  entries.set(key, entry);
}

function store(key: string, entry: Entry): void {
  touch(key, entry);
  while (entries.size > MAX_ENTRIES) {
    const oldest = entries.keys().next().value;
    if (oldest === undefined) break;
    entries.delete(oldest);
  }
}

/**
 * Returns the cached value for `key` while it is fresh. Otherwise calls
 * `fetcher` (once, however many callers are waiting), caches the result and
 * returns it. If the fetch fails, returns the previous value marked stale when
 * it is younger than `maxStaleMs`; else rethrows the error.
 */
export async function cached<T>(
  key: string,
  fetcher: () => Promise<T>,
  options: CachedOptions<T>
): Promise<CacheResult<T>> {
  const now = Date.now();
  const entry = entries.get(key);
  if (entry && now < entry.expiresAt) {
    touch(key, entry);
    return { value: entry.value as T, stale: false, fetchedAt: entry.fetchedAt };
  }

  const pending = inflight.get(key);
  if (pending) return pending as Promise<CacheResult<T>>;

  const maxStaleMs = options.maxStaleMs ?? DEFAULT_MAX_STALE_MS;
  const promise = (async (): Promise<CacheResult<T>> => {
    try {
      const value = await fetcher();
      const fetchedAt = Date.now();
      const ttl = typeof options.ttlMs === "function" ? options.ttlMs(value) : options.ttlMs;
      store(key, { value, fetchedAt, expiresAt: fetchedAt + Math.max(0, ttl), maxStaleMs });
      return { value, stale: false, fetchedAt };
    } catch (err) {
      const prev = entries.get(key);
      if (prev && Date.now() - prev.fetchedAt <= prev.maxStaleMs) {
        return { value: prev.value as T, stale: true, fetchedAt: prev.fetchedAt };
      }
      throw err;
    } finally {
      inflight.delete(key);
    }
  })();
  inflight.set(key, promise as Promise<CacheResult<unknown>>);
  return promise;
}

/**
 * The cached value for `key` if it was fetched within `maxAgeMs`, fresh or
 * not, without fetching. `stale` is true once its TTL has passed.
 */
export function peek<T>(key: string, maxAgeMs: number): CacheResult<T> | null {
  const entry = entries.get(key);
  const now = Date.now();
  if (!entry || now - entry.fetchedAt > maxAgeMs) return null;
  return { value: entry.value as T, stale: now >= entry.expiresAt, fetchedAt: entry.fetchedAt };
}

// ---------------------------------------------------------------------------
// Per-upstream cooldown and call budget

interface UpstreamState {
  cooldownUntil: number;
  /** Epoch ms of the calls made in the last minute (sliding window). */
  calls: number[];
}

const upstreams = new Map<string, UpstreamState>();

function upstreamState(name: string): UpstreamState {
  let state = upstreams.get(name);
  if (!state) {
    state = { cooldownUntil: 0, calls: [] };
    upstreams.set(name, state);
  }
  return state;
}

/** Stops calls to `name` for `seconds` (e.g. after an upstream 429). */
export function setCooldown(name: string, seconds: number): void {
  const state = upstreamState(name);
  const until = Date.now() + Math.max(0, seconds) * 1000;
  state.cooldownUntil = Math.max(state.cooldownUntil, until);
}

/** Milliseconds left in `name`'s cooldown, 0 when calls are allowed. */
export function cooldownRemainingMs(name: string): number {
  const state = upstreams.get(name);
  return state ? Math.max(0, state.cooldownUntil - Date.now()) : 0;
}

/**
 * Reserves one call to upstream `name`, allowing at most `perMinute` calls in
 * any 60s window. Throws an UpstreamError (status 503, with retryAfterS) while
 * the upstream is cooling down or the budget is spent, so cached() can fall
 * back to a stale value.
 */
export function acquireUpstream(name: string, perMinute: number): void {
  const now = Date.now();
  const state = upstreamState(name);
  if (now < state.cooldownUntil) {
    throw new UpstreamError(
      `${name} is rate limited`,
      503,
      Math.ceil((state.cooldownUntil - now) / 1000)
    );
  }
  state.calls = state.calls.filter((t) => now - t < 60_000);
  if (state.calls.length >= perMinute) {
    const waitMs = 60_000 - (now - state.calls[0]);
    throw new UpstreamError(`${name} call budget exhausted`, 503, Math.max(1, Math.ceil(waitMs / 1000)));
  }
  state.calls.push(now);
}

/** Test helper: forgets every cached value, in-flight call and upstream state. */
export function resetServerCache(): void {
  entries.clear();
  inflight.clear();
  upstreams.clear();
}
