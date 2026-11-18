import { getMarkets, TTL } from "@/lib/markets/service";
import { cachedJson, failureResponse } from "@/lib/server/respond";

export const dynamic = "force-dynamic";

/** Curated market list merged with Jupiter Price v3 and Tokens v2 stats. */
export async function GET() {
  try {
    const { data, stale, expiresAt } = await getMarkets();
    return cachedJson(data, TTL.listPrice, stale, expiresAt);
  } catch (err) {
    return failureResponse(err, 10, "Market data");
  }
}
