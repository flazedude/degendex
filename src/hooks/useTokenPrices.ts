"use client";

import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { chunkList, fetchMarketJson, normalizeMints, retryOnce } from "@/lib/markets/client";
import { MAX_PRICE_IDS } from "@/lib/markets/validate";

export type TokenPrices = Record<string, { usdPrice: number; change24hPct: number | null }>;

interface PricesResponse {
  prices?: TokenPrices;
  updatedAt?: number;
  stale?: boolean;
}

/** What the query caches: the merged prices plus whether the server marked any chunk stale. */
export interface PricesData {
  prices: TokenPrices;
  stale: boolean;
}

/**
 * Merges the chunk responses by mint, keeping only `ids` with a numeric price.
 * `stale` is true when the server marked any chunk stale (an old value served
 * after an upstream failure, or mints it could not fetch left out).
 */
export function mergePriceParts(ids: readonly string[], parts: readonly PricesResponse[]): PricesData {
  const prices: TokenPrices = {};
  for (const part of parts) {
    for (const id of ids) {
      const p = part.prices?.[id];
      if (p && typeof p.usdPrice === "number") prices[id] = p;
    }
  }
  return { prices, stale: parts.some((p) => p.stale === true) };
}

/**
 * Whether the prices on screen may be out of date: the server said so, or the
 * last refetch failed and react-query is still showing the previous data.
 */
export function pricesStale(serverStale: boolean | undefined, isRefetchError: boolean): boolean {
  return serverStale === true || isRefetchError;
}

export type TokenPricesResult = UseQueryResult<TokenPrices> & { stale: boolean };

/**
 * `query` plus a `stale` field. Wraps rather than copies, so react-query keeps
 * tracking (and re-rendering for) only the fields the caller reads.
 */
export function withStale<Q extends object>(query: Q, stale: boolean): Q & { stale: boolean } {
  return new Proxy(query, {
    get: (target, prop, receiver) => (prop === "stale" ? stale : Reflect.get(target, prop, receiver)),
    has: (target, prop) => prop === "stale" || Reflect.has(target, prop),
    ownKeys: (target) => [...Reflect.ownKeys(target), "stale"],
    getOwnPropertyDescriptor: (target, prop) =>
      prop === "stale"
        ? { value: stale, enumerable: true, configurable: true, writable: false }
        : Reflect.getOwnPropertyDescriptor(target, prop),
  }) as Q & { stale: boolean };
}

/** The query both observers in useTokenPrices share (key, fetcher, caching). */
export function tokenPricesQuery(ids: readonly string[]) {
  return {
    queryKey: ["tokenPrices", ids.join(",")],
    enabled: ids.length > 0,
    queryFn: async ({ signal }: { signal: AbortSignal }): Promise<PricesData> => {
      const parts = await Promise.all(
        chunkList(ids, MAX_PRICE_IDS).map((chunk) =>
          fetchMarketJson<PricesResponse>(
            `/api/market/prices?${new URLSearchParams({ ids: chunk.join(",") })}`,
            signal
          )
        )
      );
      return mergePriceParts(ids, parts);
    },
    staleTime: 15_000,
    retry: retryOnce,
  };
}

export const selectPrices = (d: PricesData): TokenPrices => d.prices;
export const selectServerStale = (d: PricesData): boolean => d.stale;

/**
 * Jupiter USD prices for `mints` (any order, duplicates ignored), fetched in
 * chunks of <= 50 and merged by mint. Mints without a reliable price are
 * absent. Polls every 30s; disabled for an empty list. `stale` flags prices
 * that may be delayed (see pricesStale).
 */
export function useTokenPrices(mints: string[]): TokenPricesResult {
  const options = tokenPricesQuery(normalizeMints(mints));
  const query = useQuery({
    ...options,
    select: selectPrices,
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
  });
  // A second observer of the same query that only reads the server's stale
  // flag. It never fetches itself, so it adds no requests or polling.
  const serverStale = useQuery({ ...options, enabled: false, select: selectServerStale }).data;
  return withStale(query, pricesStale(serverStale, query.isRefetchError));
}
