import type { NextRequest } from "next/server";
import { isValidPubkey } from "@/lib/jupiter/params";
import { getMarketTrades, TTL } from "@/lib/markets/service";
import { badRequest, cachedJson, failureResponse } from "@/lib/server/respond";

export const dynamic = "force-dynamic";

/** Recent trades of the mint on its top GeckoTerminal pool, newest first. */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ mint: string }> }) {
  const { mint } = await params;
  if (!isValidPubkey(mint)) return badRequest("Invalid mint");
  try {
    const { data, stale, expiresAt } = await getMarketTrades(mint);
    return cachedJson(data, TTL.trades, stale, expiresAt);
  } catch (err) {
    return failureResponse(err, 60, "Trades");
  }
}
