"use client";

import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { chunkList, normalizeMints } from "@/lib/markets/client";
import { fetchTokens } from "@/lib/tokens/map";
import type { TokenInfo } from "@/lib/tokens/types";

/** The token proxy caps its query at 2000 chars: 40 mints fit comfortably. */
const METADATA_CHUNK = 40;

/**
 * Jupiter metadata (symbol, decimals, icon, verification...) for `mints`, via
 * the existing /api/jupiter/tokens proxy in batches of <= 40. Unknown mints
 * are absent. Metadata rarely changes, so it is kept for a long time.
 */
export function useTokenMetadata(mints: string[]): UseQueryResult<Record<string, TokenInfo>> {
  const ids = normalizeMints(mints);
  return useQuery({
    queryKey: ["tokenMetadata", ids.join(",")],
    enabled: ids.length > 0,
    queryFn: async ({ signal }) => {
      const wanted = new Set(ids);
      const parts = await Promise.all(
        chunkList(ids, METADATA_CHUNK).map((chunk) => fetchTokens(chunk.join(","), signal))
      );
      const out: Record<string, TokenInfo> = {};
      for (const tokens of parts) {
        for (const t of tokens) if (wanted.has(t.mint) && !out[t.mint]) out[t.mint] = t;
      }
      return out;
    },
    staleTime: 30 * 60_000,
    gcTime: 60 * 60_000,
    retry: 1,
  });
}
