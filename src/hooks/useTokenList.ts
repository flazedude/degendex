"use client";

import { useQuery } from "@tanstack/react-query";
import type { DexScreenerPair } from "@/lib/api/dexscreener";

interface ExploreResponse {
  pairs: DexScreenerPair[];
}

export function useTokenList(
  sortBy: "volume" | "liquidity" | "priceChange" = "volume",
  sortType: "asc" | "desc" = "desc"
) {
  return useQuery<ExploreResponse>({
    queryKey: ["explore-tokens"],
    queryFn: async () => {
      const res = await fetch("/api/explore");
      if (!res.ok) throw new Error("Failed to fetch tokens");
      return res.json();
    },
    staleTime: 60_000,
    select: (data) => {
      const sorted = [...data.pairs].sort((a, b) => {
        let aVal = 0, bVal = 0;
        if (sortBy === "volume") {
          aVal = a.volume?.h24 ?? 0;
          bVal = b.volume?.h24 ?? 0;
        } else if (sortBy === "liquidity") {
          aVal = a.liquidity?.usd ?? 0;
          bVal = b.liquidity?.usd ?? 0;
        } else if (sortBy === "priceChange") {
          aVal = a.priceChange?.h24 ?? 0;
          bVal = b.priceChange?.h24 ?? 0;
        }
        return sortType === "desc" ? bVal - aVal : aVal - bVal;
      });
      return { pairs: sorted };
    },
  });
}
