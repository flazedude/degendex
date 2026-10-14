"use client";

import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { fetchMarketJson, retryOnce } from "@/lib/markets/client";
import type { MarketsResponse } from "@/lib/markets/types";

/** Curated market list with live prices; polls every 15s while the tab is visible. */
export function useMarkets(): UseQueryResult<MarketsResponse> {
  return useQuery({
    queryKey: ["markets"],
    queryFn: ({ signal }) => fetchMarketJson<MarketsResponse>("/api/markets", signal),
    staleTime: 10_000,
    refetchInterval: 15_000,
    refetchIntervalInBackground: false,
    retry: retryOnce,
  });
}
