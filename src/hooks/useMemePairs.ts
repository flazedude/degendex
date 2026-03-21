"use client";

import { useQuery } from "@tanstack/react-query";
import type { DexScreenerPair } from "@/lib/api/dexscreener";

interface MemePairsResponse {
  pairs: DexScreenerPair[];
}

export function useMemePairs() {
  return useQuery<MemePairsResponse>({
    queryKey: ["memePairs"],
    queryFn: async () => {
      const res = await fetch("/api/memes");
      if (!res.ok) throw new Error("Failed to fetch meme pairs");
      return res.json();
    },
    staleTime: 15_000,
    refetchInterval: 15_000, // Poll every 15 seconds for live updates
  });
}
