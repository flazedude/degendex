"use client";

import { useQuery } from "@tanstack/react-query";
import type { BirdeyeTokenOverview } from "@/lib/api/birdeye";

interface TokenListResponse {
  tokens: BirdeyeTokenOverview[];
  total: number;
}

export function useTokenList(
  sortBy: "v24hUSD" | "mc" | "v24hChangePercent" = "v24hUSD",
  sortType: "asc" | "desc" = "desc",
  offset = 0,
  limit = 20
) {
  return useQuery<TokenListResponse>({
    queryKey: ["tokenList", sortBy, sortType, offset, limit],
    queryFn: async () => {
      const params = new URLSearchParams({
        sortBy,
        sortType,
        offset: offset.toString(),
        limit: limit.toString(),
      });
      const res = await fetch(`/api/tokens?${params}`);
      if (!res.ok) throw new Error("Failed to fetch tokens");
      return res.json();
    },
    staleTime: 60_000,
  });
}
