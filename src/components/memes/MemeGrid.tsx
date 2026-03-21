"use client";

import { useState } from "react";
import { RefreshCw, Flame, TrendingUp, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useMemePairs } from "@/hooks/useMemePairs";
import { MemeCard } from "./MemeCard";
import { cn } from "@/lib/utils";
import type { DexScreenerPair } from "@/lib/api/dexscreener";

type SortMode = "newest" | "volume" | "gainers";

function sortPairs(pairs: DexScreenerPair[], mode: SortMode): DexScreenerPair[] {
  const sorted = [...pairs];
  switch (mode) {
    case "newest":
      return sorted.sort((a, b) => (b.pairCreatedAt ?? 0) - (a.pairCreatedAt ?? 0));
    case "volume":
      return sorted.sort((a, b) => (b.volume?.h24 ?? 0) - (a.volume?.h24 ?? 0));
    case "gainers":
      return sorted.sort(
        (a, b) => (b.priceChange?.h24 ?? 0) - (a.priceChange?.h24 ?? 0)
      );
    default:
      return sorted;
  }
}

export function MemeGrid() {
  const { data, isLoading, isError, dataUpdatedAt, refetch, isFetching } = useMemePairs();
  const [sortMode, setSortMode] = useState<SortMode>("newest");

  const pairs = data?.pairs ? sortPairs(data.pairs, sortMode) : [];
  const lastUpdated = dataUpdatedAt
    ? new Date(dataUpdatedAt).toLocaleTimeString()
    : null;

  return (
    <div className="space-y-4">
      {/* Controls */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          {(
            [
              { mode: "newest" as const, label: "Newest", icon: Clock },
              { mode: "volume" as const, label: "Hot", icon: Flame },
              { mode: "gainers" as const, label: "Top Gainers", icon: TrendingUp },
            ] as const
          ).map(({ mode, label, icon: Icon }) => (
            <Button
              key={mode}
              variant="outline"
              size="sm"
              onClick={() => setSortMode(mode)}
              className={cn(
                "text-xs gap-1.5",
                sortMode === mode &&
                  "border-primary bg-primary/10 text-primary"
              )}
            >
              <Icon className="h-3.5 w-3.5" />
              {label}
            </Button>
          ))}
        </div>

        <div className="flex items-center gap-3">
          {lastUpdated && (
            <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <span className="h-2 w-2 rounded-full bg-neon-green pulse-glow" />
              Live &middot; {lastUpdated}
            </span>
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => refetch()}
            disabled={isFetching}
            className="h-8 px-2 text-muted-foreground"
          >
            <RefreshCw className={cn("h-4 w-4", isFetching && "animate-spin")} />
          </Button>
        </div>
      </div>

      {/* Grid */}
      {isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="rounded-lg border border-border/50 bg-card/80 p-4 space-y-3">
              <div className="flex items-center gap-3">
                <Skeleton className="h-10 w-10 rounded-full" />
                <div className="space-y-1.5 flex-1">
                  <Skeleton className="h-4 w-20" />
                  <Skeleton className="h-3 w-32" />
                </div>
                <Skeleton className="h-4 w-16" />
              </div>
              <Skeleton className="h-[200px] w-full rounded-lg" />
              <div className="grid grid-cols-4 gap-2">
                {Array.from({ length: 4 }).map((_, j) => (
                  <Skeleton key={j} className="h-8 w-full" />
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : isError ? (
        <div className="rounded-lg border border-dashed border-border py-20 text-center">
          <p className="text-muted-foreground">
            Failed to load memecoins. DexScreener might be rate limiting.
          </p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => refetch()}
            className="mt-4"
          >
            Try Again
          </Button>
        </div>
      ) : pairs.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border py-20 text-center">
          <p className="text-muted-foreground">No meme pairs found right now. Check back soon.</p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {pairs.map((pair) => (
            <MemeCard key={pair.pairAddress} pair={pair} />
          ))}
        </div>
      )}
    </div>
  );
}
