"use client";

import { useQuery } from "@tanstack/react-query";

interface PriceData {
  value: number;
  updateUnixTime: number;
}

export function useTokenPrice(address: string | null) {
  return useQuery<PriceData>({
    queryKey: ["tokenPrice", address],
    queryFn: async () => {
      const res = await fetch(`/api/price?address=${address}`);
      if (!res.ok) throw new Error("Failed to fetch price");
      return res.json();
    },
    enabled: !!address,
    staleTime: 30_000,
    refetchInterval: 30_000,
  });
}
