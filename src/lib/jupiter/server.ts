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
  cacheControl = "no-store"
): NextResponse {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": cacheControl },
  });
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
