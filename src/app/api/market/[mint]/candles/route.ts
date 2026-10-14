import type { NextRequest } from "next/server";
import { isValidPubkey } from "@/lib/jupiter/params";
import { getMarketCandles, TTL } from "@/lib/markets/service";
import { isTimeframe } from "@/lib/markets/types";
import { badRequest, cachedJson, failureResponse } from "@/lib/server/respond";

export const dynamic = "force-dynamic";

/** Ascending USD candles of the mint's top GeckoTerminal pool. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ mint: string }> }) {
  const { mint } = await params;
  if (!isValidPubkey(mint)) return badRequest("Invalid mint");
  const tfs = req.nextUrl.searchParams.getAll("tf");
  const tf = tfs[0];
  if (tfs.length !== 1 || !isTimeframe(tf)) {
    return badRequest("tf must be one of 1m, 5m, 15m, 1h, 4h, 1d");
  }
  try {
    const { data, stale } = await getMarketCandles(mint, tf);
    return cachedJson(data, TTL.candles, stale);
  } catch (err) {
    return failureResponse(err, 60, "Chart data");
  }
}
