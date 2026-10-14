// Server-only, in-process cache for upstream market data.
//
// Every visitor of the site shares one Jupiter rate-limit bucket (per org) and
// one GeckoTerminal quota (per egress IP), so upstream calls must not scale with
// traffic. This module provides:
// - a TTL cache with single-flight: concurrent callers for the same key share
//   one in-flight upstream Promise;
// - a batched variant (cachedMany) that caches one entry per id, serves the
//   fresh ids from the cache and fetches only the missing or expired ones in a
//   single upstream call, sharing in-flight ids with concurrent requests;
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
  /** Epoch ms when `value` stops being fresh (in the past when `stale`). */
  expiresAt: number;
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
    return { value: entry.value as T, stale: false, fetchedAt: entry.fetchedAt, expiresAt: entry.expiresAt };
  }

  const pending = inflight.get(key);
  if (pending) return pending as Promise<CacheResult<T>>;

  const maxStaleMs = options.maxStaleMs ?? DEFAULT_MAX_STALE_MS;
  const promise = (async (): Promise<CacheResult<T>> => {
    try {
      const value = await fetcher();
      const fetchedAt = Date.now();
      const ttl = typeof options.ttlMs === "function" ? options.ttlMs(value) : options.ttlMs;
      const expiresAt = fetchedAt + Math.max(0, ttl);
      store(key, { value, fetchedAt, expiresAt, maxStaleMs });
      return { value, stale: false, fetchedAt, expiresAt };
    } catch (err) {
      const prev = entries.get(key);
      if (prev && Date.now() - prev.fetchedAt <= prev.maxStaleMs) {
        return { value: prev.value as T, stale: true, fetchedAt: prev.fetchedAt, expiresAt: prev.expiresAt };
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
  return {
    value: entry.value as T,
    stale: now >= entry.expiresAt,
    fetchedAt: entry.fetchedAt,
    expiresAt: entry.expiresAt,
  };
}

// ---------------------------------------------------------------------------
// Batched, per-id cache

export interface CachedManyOptions<T> {
  /** Fresh lifetime in ms of `id`'s value; `null` means upstream had none for it. */
  ttlMs: (value: T | null, id: string) => number;
  /** How old a value may be and still be served stale after an error. Default 10 min. */
  maxStaleMs?: number;
  /** Most ids one upstream call may carry (only extras are trimmed to fit). */
  maxBatch?: number;
  /**
   * Fraction of its TTL after which a fresh requested id is refreshed too when
   * a call is being made anyway (it costs nothing extra and keeps the ids of a
   * set expiring together). Default 0.5.
   */
  refreshAhead?: number;
  /**
   * Ids that are not requested but ride along when a call is made anyway and
   * they are missing or due for a refresh (e.g. the curated set). Their
   * results are cached, not returned.
   */
  companions?: readonly string[];
}

export interface CachedManyResult<T> {
  /**
   * Per requested id: the fresh value, or the last good value marked stale
   * when the refresh failed. A `null` value means upstream has no data for
   * the id. Ids with nothing usable are absent.
   */
  results: Map<string, CacheResult<T | null>>;
  /** The upstream error when any requested id could not be refreshed. */
  error?: unknown;
}

/**
 * Like cached(), but for a set of ids cached one entry per id under
 * `keyOf(id)`. Fresh ids come from the cache; the missing or expired ones
 * (minus those another request is already fetching, which are awaited) are
 * fetched with one `fetcher` call. `fetcher` returns the values it found by
 * id; ids it omits are cached as `null`. A failed fetch never fails the whole
 * set: ids with a recent value are served stale, the rest are absent and
 * `error` is set.
 */
export async function cachedMany<T>(
  ids: readonly string[],
  keyOf: (id: string) => string,
  fetcher: (ids: string[]) => Promise<Record<string, T>>,
  options: CachedManyOptions<T>
): Promise<CachedManyResult<T>> {
  const now = Date.now();
  const unique = Array.from(new Set(ids));
  const requested = new Set(unique);
  const refreshAhead = options.refreshAhead ?? 0.5;
  const results = new Map<string, CacheResult<T | null>>();
  const waits: Array<[string, Promise<CacheResult<unknown>>]> = [];
  const toFetch: string[] = [];
  const extras: string[] = [];

  /** True when a fresh entry is old enough to refresh in a call made anyway. */
  const aging = (entry: Entry) =>
    now - entry.fetchedAt >= (entry.expiresAt - entry.fetchedAt) * refreshAhead;

  for (const id of unique) {
    const key = keyOf(id);
    const entry = entries.get(key);
    if (entry && now < entry.expiresAt) {
      touch(key, entry);
      results.set(id, {
        value: entry.value as T | null,
        stale: false,
        fetchedAt: entry.fetchedAt,
        expiresAt: entry.expiresAt,
      });
      if (!inflight.has(key) && aging(entry)) extras.push(id);
      continue;
    }
    const pending = inflight.get(key);
    if (pending) waits.push([id, pending]);
    else toFetch.push(id);
  }

  if (toFetch.length > 0) {
    for (const id of options.companions ?? []) {
      if (requested.has(id)) continue;
      const key = keyOf(id);
      if (inflight.has(key)) continue;
      const entry = entries.get(key);
      if (!entry || now >= entry.expiresAt || aging(entry)) extras.push(id);
    }
    const room = Math.max(0, (options.maxBatch ?? Infinity) - toFetch.length);
    const batchIds = [...toFetch, ...Array.from(new Set(extras)).slice(0, room)];
    const maxStaleMs = options.maxStaleMs ?? DEFAULT_MAX_STALE_MS;
    let batch: Promise<Record<string, T>>;
    try {
      batch = fetcher(batchIds);
    } catch (err) {
      batch = Promise.reject(err);
    }
    const fetching = new Set(toFetch);

    for (const id of batchIds) {
      const key = keyOf(id);
      const promise: Promise<CacheResult<T | null>> = batch
        .then(
          (found) => {
            const value = Object.prototype.hasOwnProperty.call(found, id) ? found[id] : null;
            const fetchedAt = Date.now();
            const expiresAt = fetchedAt + Math.max(0, options.ttlMs(value, id));
            store(key, { value, fetchedAt, expiresAt, maxStaleMs });
            return { value, stale: false, fetchedAt, expiresAt };
          },
          (err: unknown) => {
            const prev = entries.get(key);
            const at = Date.now();
            if (prev && at - prev.fetchedAt <= prev.maxStaleMs) {
              return {
                value: prev.value as T | null,
                stale: at >= prev.expiresAt,
                fetchedAt: prev.fetchedAt,
                expiresAt: prev.expiresAt,
              };
            }
            throw err;
          }
        )
        .finally(() => {
          if (inflight.get(key) === promise) inflight.delete(key);
        });
      inflight.set(key, promise as Promise<CacheResult<unknown>>);
      if (fetching.has(id)) waits.push([id, promise]);
      // Extras are already answered from the cache (or not wanted at all).
      else promise.catch(() => undefined);
    }
  }

  let error: unknown;
  let servedStale = false;
  const settled = await Promise.allSettled(waits.map(([, p]) => p));
  settled.forEach((outcome, i) => {
    if (outcome.status === "fulfilled") {
      const res = outcome.value as CacheResult<T | null>;
      results.set(waits[i][0], res);
      servedStale ||= res.stale;
    } else {
      error ??= outcome.reason;
    }
  });
  if (error === undefined && servedStale) {
    error = new UpstreamError("Refresh failed; serving the last good value", 503);
  }
  return { results, error };
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
