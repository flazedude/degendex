"use client";

import { useState } from "react";
import { RefreshCw, Flame, TrendingUp, Clock, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useMemePairs } from "@/hooks/useMemePairs";
import { MemeCard } from "./MemeCard";
import { cn, formatNumber } from "@/lib/utils";
import { getDexScreenerChartEmbed, getDexScreenerChartUrl, type DexScreenerPair } from "@/lib/api/dexscreener";
import Link from "next/link";

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

const PAGE_SIZE = 50;

export function MemeGrid() {
  const { data, isLoading, isError, dataUpdatedAt, refetch, isFetching } = useMemePairs();
  const [sortMode, setSortMode] = useState<SortMode>("newest");
  const [selectedPair, setSelectedPair] = useState<DexScreenerPair | null>(null);
  const [page, setPage] = useState(0);

  const allPairs = data?.pairs ? sortPairs(data.pairs, sortMode) : [];
  const totalPages = Math.ceil(allPairs.length / PAGE_SIZE);
  const pairs = allPairs.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const lastUpdated = dataUpdatedAt
    ? new Date(dataUpdatedAt).toLocaleTimeString()
    : null;

  return (
    <div className="space-y-2">
      {/* Controls */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1">
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
              onClick={() => { setSortMode(mode); setPage(0); }}
              className={cn(
                "text-xs gap-1 h-7 px-2",
                sortMode === mode &&
                  "border-primary bg-primary/10 text-primary"
              )}
            >
              <Icon className="h-3 w-3" />
              {label}
            </Button>
          ))}
        </div>

        <div className="flex items-center gap-2">
          {lastUpdated && (
            <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <span className="h-1.5 w-1.5 rounded-full bg-neon-green pulse-glow" />
              Live &middot; {lastUpdated}
            </span>
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => refetch()}
            disabled={isFetching}
            className="h-7 w-7 p-0 text-muted-foreground"
          >
            <RefreshCw className={cn("h-3.5 w-3.5", isFetching && "animate-spin")} />
          </Button>
        </div>
      </div>

      {/* Grid */}
      {isLoading ? (
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {Array.from({ length: 12 }).map((_, i) => (
            <div key={i} className="border border-border/50 bg-card/80 p-3 space-y-2">
              <div className="flex items-center gap-2">
                <Skeleton className="h-8 w-8 rounded-full" />
                <div className="space-y-1 flex-1">
                  <Skeleton className="h-3.5 w-16" />
                  <Skeleton className="h-3 w-24" />
                </div>
                <Skeleton className="h-3.5 w-14" />
              </div>
              <div className="grid grid-cols-4 gap-1">
                {Array.from({ length: 4 }).map((_, j) => (
                  <Skeleton key={j} className="h-7 w-full" />
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : isError ? (
        <div className="border border-dashed border-border py-12 text-center">
          <p className="text-sm text-muted-foreground">
            Failed to load memecoins. DexScreener might be rate limiting.
          </p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => refetch()}
            className="mt-3 h-7 text-xs"
          >
            Try Again
          </Button>
        </div>
      ) : pairs.length === 0 ? (
        <div className="border border-dashed border-border py-12 text-center">
          <p className="text-sm text-muted-foreground">No meme pairs found right now. Check back soon.</p>
        </div>
      ) : (
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {pairs.map((pair) => (
            <MemeCard
              key={pair.pairAddress}
              pair={pair}
              onClick={() => setSelectedPair(pair)}
            />
          ))}
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 pt-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            disabled={page === 0}
            className="h-7 text-xs"
          >
            Prev
          </Button>
          <span className="text-xs text-muted-foreground font-mono">
            {page + 1} / {totalPages} ({allPairs.length} tokens)
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
            disabled={page >= totalPages - 1}
            className="h-7 text-xs"
          >
            Next
          </Button>
        </div>
      )}

      {/* Chart Dialog */}
      <Dialog open={!!selectedPair} onOpenChange={(open) => !open && setSelectedPair(null)}>
        <DialogContent className="flex flex-col max-w-4xl h-[80vh] p-0 !gap-0 bg-card border-border/50">
          {selectedPair && (
            <>
              <div className="px-3 pt-3 pb-2 space-y-2 shrink-0">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    {selectedPair.info?.imageUrl ? (
                      <img
                        src={selectedPair.info.imageUrl}
                        alt={selectedPair.baseToken.symbol}
                        className="h-6 w-6 rounded-full"
                      />
                    ) : (
                      <div className="flex h-6 w-6 items-center justify-center rounded-full bg-muted text-[10px] font-bold">
                        {selectedPair.baseToken.symbol?.[0] || "?"}
                      </div>
                    )}
                    <div>
                      <DialogTitle className="text-sm">
                        {selectedPair.baseToken.symbol}/{selectedPair.quoteToken.symbol}
                      </DialogTitle>
                      <p className="text-[10px] text-muted-foreground">{selectedPair.baseToken.name}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Link href="/swap">
                      <Button size="sm" className="h-6 px-2 text-[11px] bg-primary text-primary-foreground hover:bg-primary/90 glow-green-sm">
                        Swap
                      </Button>
                    </Link>
                    <a
                      href={getDexScreenerChartUrl(selectedPair.pairAddress)}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <Button variant="outline" size="sm" className="h-6 px-2 text-[11px] gap-1">
                        DexScreener
                        <ExternalLink className="h-3 w-3" />
                      </Button>
                    </a>
                  </div>
                </div>

                {/* Quick stats */}
                <div className="grid grid-cols-5 gap-1 bg-background/50 p-1.5">
                  <div className="text-center">
                    <p className="text-[10px] text-muted-foreground">Price</p>
                    <p className="text-[11px] font-mono font-medium">
                      {selectedPair.priceUsd
                        ? parseFloat(selectedPair.priceUsd) < 0.0001
                          ? `$${parseFloat(selectedPair.priceUsd).toExponential(2)}`
                          : `$${parseFloat(selectedPair.priceUsd).toFixed(parseFloat(selectedPair.priceUsd) < 1 ? 6 : 2)}`
                        : "N/A"}
                    </p>
                  </div>
                  <div className="text-center">
                    <p className="text-[10px] text-muted-foreground">5m</p>
                    <p className={cn("text-[11px] font-medium", (selectedPair.priceChange?.m5 ?? 0) >= 0 ? "text-primary" : "text-destructive")}>
                      {(selectedPair.priceChange?.m5 ?? 0) >= 0 ? "+" : ""}{(selectedPair.priceChange?.m5 ?? 0).toFixed(1)}%
                    </p>
                  </div>
                  <div className="text-center">
                    <p className="text-[10px] text-muted-foreground">24h</p>
                    <p className={cn("text-[11px] font-medium", (selectedPair.priceChange?.h24 ?? 0) >= 0 ? "text-primary" : "text-destructive")}>
                      {(selectedPair.priceChange?.h24 ?? 0) >= 0 ? "+" : ""}{(selectedPair.priceChange?.h24 ?? 0).toFixed(1)}%
                    </p>
                  </div>
                  <div className="text-center">
                    <p className="text-[10px] text-muted-foreground">Vol 24h</p>
                    <p className="text-[11px] font-medium">${formatNumber(selectedPair.volume?.h24 ?? 0)}</p>
                  </div>
                  <div className="text-center">
                    <p className="text-[10px] text-muted-foreground">Liquidity</p>
                    <p className="text-[11px] font-medium">${formatNumber(selectedPair.liquidity?.usd ?? 0)}</p>
                  </div>
                </div>
              </div>

              {/* DexScreener Chart */}
              <div className="flex-1 min-h-0 px-3 pb-3">
                <iframe
                  src={getDexScreenerChartEmbed(selectedPair.pairAddress)}
                  className="h-full w-full border border-border/30"
                  title={`${selectedPair.baseToken.symbol} chart`}
                />
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
