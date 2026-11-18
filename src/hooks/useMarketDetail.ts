"use client";

import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { isValidPubkey } from "@/lib/jupiter/params";
import { fetchMarketJson, retryOnce } from "@/lib/markets/client";
import type { MarketDetail } from "@/lib/markets/types";

/** Header data for one mint; polls every 15s while the tab is visible. */
export function useMarketDetail(mint: string | null): UseQueryResult<MarketDetail> {
  return useQuery({
    queryKey: ["marketDetail", mint],
    enabled: isValidPubkey(mint),
    queryFn: ({ signal }) =>
      fetchMarketJson<MarketDetail>(`/api/market/${encodeURIComponent(mint!)}`, signal),
    staleTime: 10_000,
    refetchInterval: 15_000,
    refetchIntervalInBackground: false,
    retry: retryOnce,
  });
}
