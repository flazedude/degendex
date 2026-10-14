import type { NextRequest } from "next/server";
import { parsePriceIds } from "@/lib/markets/validate";
import { getPrices, TTL } from "@/lib/markets/service";
import { badRequest, cachedJson, failureResponse } from "@/lib/server/respond";

export const dynamic = "force-dynamic";

/**
 * Jupiter USD prices for up to 50 mints. Mints with no reliable price are
 * absent; so are mints that could not be fetched, in which case the body has
 * `stale: true`.
 */
export async function GET(req: NextRequest) {
  const parsed = parsePriceIds(req.nextUrl.searchParams.getAll("ids"));
  if (!parsed.ok) return badRequest(parsed.error);
  try {
    const { data, stale, expiresAt } = await getPrices(parsed.value);
    return cachedJson(data, TTL.prices, stale, expiresAt);
  } catch (err) {
    return failureResponse(err, 15, "Prices");
  }
}
