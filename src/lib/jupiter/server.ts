// Server-only helpers for the Jupiter proxy routes. Never import from client
// code: this module reads JUPITER_API_KEY.
import { NextResponse } from "next/server";
import { parseReferralConfig, type ReferralConfig } from "./params";

export const JUPITER_BASE_URL = "https://api.jup.ag";

export function jupiterHeaders(json = false): Record<string, string> {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (json) headers["Content-Type"] = "application/json";
  const key = process.env.JUPITER_API_KEY?.trim();
  if (key) headers["x-api-key"] = key;
  return headers;
}

let referralCache: { config: ReferralConfig | null } | null = null;

/** Referral config from env, parsed once. Invalid config warns once and is ignored. */
export function getReferralConfig(): ReferralConfig | null {
  if (!referralCache) {
    const { config, warning } = parseReferralConfig(
      process.env.JUPITER_REFERRAL_ACCOUNT,
      process.env.JUPITER_REFERRAL_FEE_BPS
    );
    if (warning) console.warn(`[jupiter] ${warning}`);
    referralCache = { config };
  }
  return referralCache.config;
}

export function jsonResponse(
  body: unknown,
  status = 200,
  cacheControl = "no-store",
  extraHeaders: Record<string, string> = {}
): NextResponse {
  return NextResponse.json(body, {
    status,
    headers: { ...extraHeaders, "Cache-Control": cacheControl },
  });
}

const DEFAULT_RETRY_AFTER_S = 2;
const MAX_RETRY_AFTER_S = 60;

/**
 * Seconds to wait after a Jupiter 429. `x-ratelimit-reset` is an absolute unix
 * timestamp in seconds (portal rate-limit docs). Clamped to 1..60, default 2.
 */
export function retryAfterSeconds(headers: Headers, nowMs = Date.now()): number {
  const reset = Number(headers.get("x-ratelimit-reset"));
  let seconds = Number.NaN;
  if (headers.get("x-ratelimit-reset") && Number.isFinite(reset) && reset > 0) {
    seconds = Math.ceil(reset - nowMs / 1000);
  } else {
    const ra = Number(headers.get("retry-after"));
    if (headers.get("retry-after") && Number.isFinite(ra)) seconds = Math.ceil(ra);
  }
  if (!Number.isFinite(seconds)) return DEFAULT_RETRY_AFTER_S;
  return Math.min(MAX_RETRY_AFTER_S, Math.max(1, seconds));
}

/** Our 429: Retry-After header plus retryAfterMs in the body, so clients back off. */
export function rateLimitedResponse(upstream: Response): NextResponse {
  const seconds = retryAfterSeconds(upstream.headers);
  return jsonResponse(
    { error: "Rate limited by Jupiter, please retry", retryAfterMs: seconds * 1000 },
    429,
    "no-store",
    { "Retry-After": String(seconds) }
  );
}

export class BodyTooLargeError extends Error {
  constructor() {
    super("Request body too large");
    this.name = "BodyTooLargeError";
  }
}

/**
 * Reads a request body as UTF-8 text, aborting once it exceeds `maxBytes`
 * (covers chunked bodies with no Content-Length). Throws BodyTooLargeError.
 */
export async function readTextCapped(req: Request, maxBytes: number): Promise<string> {
  const declared = req.headers.get("content-length");
  if (declared !== null && Number(declared) > maxBytes) throw new BodyTooLargeError();
  if (!req.body) return "";
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => {});
      throw new BodyTooLargeError();
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    bytes.set(c, offset);
    offset += c.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

/** Reads a JSON body without throwing. */
export async function readJson(res: Response): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

/** Extracts a short, safe error string from an upstream error body. */
export function upstreamError(body: unknown, fallback: string): string {
  if (body && typeof body === "object") {
    const { error, message } = body as Record<string, unknown>;
    const text = typeof error === "string" ? error : message;
    if (typeof text === "string" && text.trim()) {
      return text.trim().slice(0, 200);
    }
  }
  return fallback;
}

export function isTimeoutError(err: unknown): boolean {
  return (
    err instanceof Error &&
    (err.name === "TimeoutError" || err.name === "AbortError")
  );
}
