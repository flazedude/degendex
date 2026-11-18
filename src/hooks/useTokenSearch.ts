"use client";

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchTokens } from "@/lib/tokens/map";

/** Debounced (~250ms) token search via /api/jupiter/tokens. */
export function useTokenSearch(query: string) {
  const trimmed = query.trim().slice(0, 200);
  const [debounced, setDebounced] = useState(trimmed);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(trimmed), 250);
    return () => clearTimeout(t);
  }, [trimmed]);

  const result = useQuery({
    queryKey: ["tokenSearch", debounced],
    enabled: debounced.length > 0,
    queryFn: ({ signal }) => fetchTokens(debounced, signal),
    staleTime: 60_000,
    retry: 1,
  });

  return {
    tokens: debounced.length > 0 ? (result.data ?? []) : [],
    isSearching:
      trimmed.length > 0 && (trimmed !== debounced || result.isFetching),
    isError: debounced.length > 0 && result.isError,
  };
}

/** Resolves full metadata for a list of mints (one batched request). */
export function useTokensByMint(mints: string[]) {
  const key = Array.from(new Set(mints.filter(Boolean))).sort().join(",");
  return useQuery({
    queryKey: ["tokensByMint", key],
    enabled: key.length > 0,
    queryFn: ({ signal }) => fetchTokens(key, signal),
    staleTime: 5 * 60_000,
    retry: 1,
  });
}
