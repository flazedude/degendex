import type { NextRequest } from "next/server";
import { isValidPubkey } from "@/lib/jupiter/params";
import { getMarketDetail, TTL } from "@/lib/markets/service";
import { badRequest, cachedJson, failureResponse } from "@/lib/server/respond";

export const dynamic = "force-dynamic";

/** Header data for any mint: Jupiter stats and price, GT pool, 24h high/low. */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ mint: string }> }) {
  const { mint } = await params;
  if (!isValidPubkey(mint)) return badRequest("Invalid mint");
  try {
    const { data, stale, expiresAt } = await getMarketDetail(mint);
    return cachedJson(data, TTL.detail, stale, expiresAt);
  } catch (err) {
    return failureResponse(err, 15, "Market data");
  }
}
