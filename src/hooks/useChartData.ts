"use client";

import { useQuery } from "@tanstack/react-query";
import type { BirdeyeOHLCV } from "@/lib/api/birdeye";

export function useChartData(
  address: string | null,
  type: "1m" | "5m" | "15m" | "1H" | "4H" | "1D" = "1H"
) {
  return useQuery<BirdeyeOHLCV[]>({
    queryKey: ["chart", address, type],
    queryFn: async () => {
      const params = new URLSearchParams({ address: address!, type });
      const res = await fetch(`/api/chart?${params}`);
      if (!res.ok) throw new Error("Failed to fetch chart data");
      const data = await res.json();
      return data.items || [];
    },
    enabled: !!address,
    staleTime: 60_000,
  });
}
