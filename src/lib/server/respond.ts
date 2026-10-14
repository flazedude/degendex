// Response helpers shared by the cached market-data routes.
import type { NextResponse } from "next/server";
import { jsonResponse } from "@/lib/jupiter/server";
import { UpstreamError } from "./cache";

/**
 * CDN Cache-Control for a cached payload. Fresh data may be shared for the
 * server TTL plus a few multiples of stale-while-revalidate. Stale data (the
 * upstream failed) is only shared briefly so recovery shows up quickly.
 */
export function cacheControl(ttlSeconds: number, stale = false): string {
  if (stale) return `public, s-maxage=${Math.min(ttlSeconds, 5)}`;
  return `public, s-maxage=${ttlSeconds}, stale-while-revalidate=${ttlSeconds * 4}`;
}

/** 200 with the payload; `stale: true` is added to the body only when stale. */
export function cachedJson<T extends object>(
  body: T,
  ttlSeconds: number,
  stale: boolean
): NextResponse {
  const payload = stale ? { ...body, stale: true } : body;
  return jsonResponse(payload, 200, cacheControl(ttlSeconds, stale));
}

export function badRequest(error: string): NextResponse {
  return jsonResponse({ error }, 400);
}

/**
 * Maps a failure with nothing cached to a response: upstream 404 stays 404,
 * everything else is 503 with Retry-After so clients and CDNs back off.
 */
export function failureResponse(err: unknown, defaultRetryS: number, label: string): NextResponse {
  if (err instanceof UpstreamError && err.status === 404) {
    return jsonResponse({ error: err.message }, 404, "public, s-maxage=60");
  }
  const retry =
    err instanceof UpstreamError && err.retryAfterS !== undefined
      ? Math.max(1, Math.min(300, err.retryAfterS))
      : defaultRetryS;
  return jsonResponse(
    { error: `${label} is temporarily unavailable`, retryAfterMs: retry * 1000 },
    503,
    "no-store",
    { "Retry-After": String(retry) }
  );
}
