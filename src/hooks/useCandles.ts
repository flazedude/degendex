"use client";

import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { isValidPubkey } from "@/lib/jupiter/params";
import { fetchMarketJson, retryOnce } from "@/lib/markets/client";
import type { CandlesResponse, Timeframe } from "@/lib/markets/types";

/**
 * Ascending USD candles for `mint` on its top pool. Polls every 60s (the
 * upstream caches for 60s, so faster polling would only spend quota).
 */
export function useCandles(mint: string | null, tf: Timeframe): UseQueryResult<CandlesResponse> {
  return useQuery({
    queryKey: ["candles", mint, tf],
    enabled: isValidPubkey(mint),
    queryFn: ({ signal }) =>
      fetchMarketJson<CandlesResponse>(
        `/api/market/${encodeURIComponent(mint!)}/candles?${new URLSearchParams({ tf })}`,
        signal
      ),
    staleTime: 30_000,
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
    retry: retryOnce,
  });
}
