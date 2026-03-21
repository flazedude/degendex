"use client";

import { useQuery } from "@tanstack/react-query";
import type { RaydiumPoolListResponse } from "@/lib/api/raydium";

export function usePools(
  type: "all" | "standard" | "concentrated" = "all",
  sort: "liquidity" | "volume24h" | "fee24h" | "apr24h" = "liquidity",
  order: "asc" | "desc" = "desc",
  page = 1
) {
  return useQuery<RaydiumPoolListResponse>({
    queryKey: ["pools", type, sort, order, page],
    queryFn: async () => {
      const params = new URLSearchParams({
        type,
        sort,
        order,
        page: page.toString(),
        pageSize: "20",
      });
      const res = await fetch(`/api/pools?${params}`);
      if (!res.ok) throw new Error("Failed to fetch pools");
      return res.json();
    },
    staleTime: 30_000,
  });
}
