import type { NextRequest } from "next/server";
import { validateTokenQuery } from "@/lib/jupiter/params";
import {
  JUPITER_BASE_URL,
  jsonResponse,
  jupiterHeaders,
  readJson,
} from "@/lib/jupiter/server";

const CACHE_OK = "public, s-maxage=60, stale-while-revalidate=300";

export async function GET(req: NextRequest) {
  const parsed = validateTokenQuery(req.nextUrl.searchParams.get("query"));
  if (!parsed.ok) return jsonResponse({ error: parsed.error }, 400);

  const qs = new URLSearchParams({ query: parsed.value });
  try {
    const res = await fetch(`${JUPITER_BASE_URL}/tokens/v2/search?${qs}`, {
      headers: jupiterHeaders(),
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
    if (res.status === 429) {
      return jsonResponse({ error: "Rate limited by Jupiter, please retry" }, 429);
    }
    const body = await readJson(res);
    if (!res.ok || !Array.isArray(body)) {
      return jsonResponse({ error: `Token search failed (${res.status})` }, 502);
    }
    return jsonResponse(body, 200, CACHE_OK);
  } catch {
    return jsonResponse({ error: "Could not reach Jupiter" }, 502);
  }
}
