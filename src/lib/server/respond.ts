// Response helpers shared by the cached market-data routes.
import type { NextResponse } from "next/server";
import { jsonResponse } from "@/lib/jupiter/server";
import { UpstreamError } from "./cache";

/**
 * CDN Cache-Control for a cached payload. `remainingSeconds` is how long the
 * server copy stays fresh (default: the full TTL): the CDN may share it only
 * for that long, plus as long again while it revalidates, so a CDN copy is at
 * most about two TTLs old. Stale data (the upstream failed, or the copy has
 * outlived its TTL) is only shared briefly so recovery shows up quickly.
 */
export function cacheControl(ttlSeconds: number, stale = false, remainingSeconds = ttlSeconds): string {
  if (stale || remainingSeconds <= 0) return `public, s-maxage=${Math.max(1, Math.min(ttlSeconds, 5))}`;
  const maxAge = Math.max(1, Math.min(ttlSeconds, Math.ceil(remainingSeconds)));
  return `public, s-maxage=${maxAge}, stale-while-revalidate=${maxAge}`;
}

/**
 * 200 with the payload; `stale: true` is added to the body only when stale.
 * `expiresAt` (epoch ms when the server copy stops being fresh) shortens the
 * CDN lifetime to what is left of the TTL.
 */
export function cachedJson<T extends object>(
  body: T,
  ttlSeconds: number,
  stale: boolean,
  expiresAt?: number,
  nowMs = Date.now()
): NextResponse {
  const payload = stale ? { ...body, stale: true } : body;
  const remaining = expiresAt === undefined ? ttlSeconds : (expiresAt - nowMs) / 1000;
  return jsonResponse(payload, 200, cacheControl(ttlSeconds, stale, remaining));
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
