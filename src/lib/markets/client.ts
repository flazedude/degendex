// Client-side helpers for the market-data hooks. No server imports here.
import { isValidPubkey } from "@/lib/jupiter/params";

export class MarketFetchError extends Error {
  readonly status: number;
  readonly retryAfterMs?: number;

  constructor(message: string, status: number, retryAfterMs?: number) {
    super(message);
    this.name = "MarketFetchError";
    this.status = status;
    this.retryAfterMs = retryAfterMs;
  }
}

/** GETs one of our /api/market* routes, throwing MarketFetchError on failure. */
export async function fetchMarketJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(url, { signal });
  const body: unknown = await res.json().catch(() => null);
  if (!res.ok || !body || typeof body !== "object") {
    const b = (body ?? {}) as { error?: unknown; retryAfterMs?: unknown };
    throw new MarketFetchError(
      typeof b.error === "string" ? b.error : `Request failed (${res.status})`,
      res.status,
      typeof b.retryAfterMs === "number" ? b.retryAfterMs : undefined
    );
  }
  return body as T;
}

/** Retry transient failures once; never retry 4xx input errors. */
export function retryOnce(failureCount: number, error: Error): boolean {
  if (error instanceof MarketFetchError && error.status >= 400 && error.status < 500 && error.status !== 429) {
    return false;
  }
  return failureCount < 1;
}

/** Valid, unique, sorted mints: a stable query key regardless of input order. */
export function normalizeMints(mints: readonly string[]): string[] {
  return Array.from(new Set(mints.filter((m) => isValidPubkey(m)))).sort();
}

export function chunkList<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}
