import type { NextRequest } from "next/server";
import { buildOrderQuery, validateOrderParams } from "@/lib/jupiter/params";
import {
  JUPITER_BASE_URL,
  getReferralConfig,
  isTimeoutError,
  jsonResponse,
  jupiterHeaders,
  rateLimitedResponse,
  readJson,
  upstreamError,
} from "@/lib/jupiter/server";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const parsed = validateOrderParams(req.nextUrl.searchParams);
  if (!parsed.ok) return jsonResponse({ error: parsed.error }, 400);

  const qs = buildOrderQuery(parsed.value, getReferralConfig());

  try {
    const res = await fetch(`${JUPITER_BASE_URL}/swap/v2/order?${qs}`, {
      headers: jupiterHeaders(),
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
    if (res.status === 429) return rateLimitedResponse(res);
    const body = await readJson(res);
    if (!res.ok || !body || typeof body !== "object") {
      // 4xx bodies carry useful text ("Could not find any route"); 5xx do not.
      const fallback = `Jupiter order failed (${res.status})`;
      const error =
        res.status >= 400 && res.status < 500
          ? upstreamError(body, fallback)
          : fallback;
      return jsonResponse({ error }, 502);
    }
    return jsonResponse(body, 200);
  } catch (err) {
    const error = isTimeoutError(err)
      ? "Jupiter took too long to respond"
      : "Could not reach Jupiter";
    return jsonResponse({ error }, 502);
  }
}
