"use client";

import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { isValidPubkey } from "@/lib/jupiter/params";
import { fetchMarketJson, retryOnce } from "@/lib/markets/client";
import type { TradesResponse } from "@/lib/markets/types";

/** Recent trades of `mint` on its top pool, newest first. Polls every 60s. */
export function useMarketTrades(mint: string | null): UseQueryResult<TradesResponse> {
  return useQuery({
    queryKey: ["marketTrades", mint],
    enabled: isValidPubkey(mint),
    queryFn: ({ signal }) =>
      fetchMarketJson<TradesResponse>(`/api/market/${encodeURIComponent(mint!)}/trades`, signal),
    staleTime: 30_000,
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
    retry: retryOnce,
  });
}
