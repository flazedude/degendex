"use client";

import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { chunkList, fetchMarketJson, normalizeMints, retryOnce } from "@/lib/markets/client";
import { MAX_PRICE_IDS } from "@/lib/markets/validate";

export type TokenPrices = Record<string, { usdPrice: number; change24hPct: number | null }>;

interface PricesResponse {
  prices: TokenPrices;
  updatedAt: number;
  stale?: boolean;
}

/**
 * Jupiter USD prices for `mints` (any order, duplicates ignored), fetched in
 * chunks of <= 50 and merged by mint. Mints without a reliable price are
 * absent. Polls every 30s; disabled for an empty list.
 */
export function useTokenPrices(mints: string[]): UseQueryResult<TokenPrices> {
  const ids = normalizeMints(mints);
  const key = ids.join(",");
  return useQuery({
    queryKey: ["tokenPrices", key],
    enabled: ids.length > 0,
    queryFn: async ({ signal }) => {
      const parts = await Promise.all(
        chunkList(ids, MAX_PRICE_IDS).map((chunk) =>
          fetchMarketJson<PricesResponse>(
            `/api/market/prices?${new URLSearchParams({ ids: chunk.join(",") })}`,
            signal
          )
        )
      );
      const out: TokenPrices = {};
      for (const part of parts) {
        for (const id of ids) {
          const p = part.prices?.[id];
          if (p && typeof p.usdPrice === "number") out[id] = p;
        }
      }
      return out;
    },
    staleTime: 15_000,
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
    retry: retryOnce,
  });
}
