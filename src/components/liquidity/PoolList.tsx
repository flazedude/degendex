"use client";

import { useState } from "react";
import { Droplets, TrendingUp, BarChart3, Percent } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { usePools } from "@/hooks/usePools";
import { PoolFilters } from "./PoolFilters";
import { formatNumber } from "@/lib/utils";
import { cn } from "@/lib/utils";
import type { RaydiumPool } from "@/lib/api/raydium";

interface PoolListProps {
  onSelectPool: (pool: RaydiumPool) => void;
}

export function PoolList({ onSelectPool }: PoolListProps) {
  const [poolType, setPoolType] = useState<"all" | "standard" | "concentrated">("all");
  const [sortBy, setSortBy] = useState<"liquidity" | "volume24h" | "fee24h" | "apr24h">("liquidity");
  const [page, setPage] = useState(1);

  const { data, isLoading, isError } = usePools(poolType, sortBy, "desc", page);
  const pools = data?.data || [];

  return (
    <div className="space-y-4">
      <PoolFilters
        poolType={poolType}
        sortBy={sortBy}
        onTypeChange={(t) => { setPoolType(t); setPage(1); }}
        onSortChange={(s) => { setSortBy(s); setPage(1); }}
      />

      <div className="rounded-lg border border-border/50 bg-card/50">
        <Table>
          <TableHeader>
            <TableRow className="border-border/50 hover:bg-transparent">
              <TableHead className="text-muted-foreground">Pool</TableHead>
              <TableHead className="text-right text-muted-foreground">
                <span className="inline-flex items-center gap-1"><Droplets className="h-3.5 w-3.5" />TVL</span>
              </TableHead>
              <TableHead className="text-right text-muted-foreground hidden sm:table-cell">
                <span className="inline-flex items-center gap-1"><BarChart3 className="h-3.5 w-3.5" />Vol 24h</span>
              </TableHead>
              <TableHead className="text-right text-muted-foreground hidden md:table-cell">
                <span className="inline-flex items-center gap-1">Fees 24h</span>
              </TableHead>
              <TableHead className="text-right text-muted-foreground">
                <span className="inline-flex items-center gap-1"><Percent className="h-3.5 w-3.5" />APR</span>
              </TableHead>
              <TableHead className="text-right text-muted-foreground hidden lg:table-cell">Fee Rate</TableHead>
              <TableHead className="w-24" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading
              ? Array.from({ length: 10 }).map((_, i) => (
                  <TableRow key={i} className="border-border/30">
                    <TableCell><div className="flex items-center gap-3"><Skeleton className="h-8 w-16 rounded-full" /><Skeleton className="h-4 w-28" /></div></TableCell>
                    <TableCell><Skeleton className="ml-auto h-4 w-16" /></TableCell>
                    <TableCell className="hidden sm:table-cell"><Skeleton className="ml-auto h-4 w-16" /></TableCell>
                    <TableCell className="hidden md:table-cell"><Skeleton className="ml-auto h-4 w-14" /></TableCell>
                    <TableCell><Skeleton className="ml-auto h-4 w-14" /></TableCell>
                    <TableCell className="hidden lg:table-cell"><Skeleton className="ml-auto h-4 w-12" /></TableCell>
                    <TableCell><Skeleton className="ml-auto h-8 w-20" /></TableCell>
                  </TableRow>
                ))
              : pools.map((pool) => (
                  <TableRow
                    key={pool.id}
                    className="border-border/30 hover:bg-muted/30 transition-colors"
                  >
                    <TableCell>
                      <div className="flex items-center gap-3">
                        {/* Token pair icons */}
                        <div className="flex -space-x-2 shrink-0">
                          {pool.mintA.logoURI ? (
                            <img src={pool.mintA.logoURI} alt={pool.mintA.symbol} className="h-7 w-7 rounded-full border-2 border-card" />
                          ) : (
                            <div className="flex h-7 w-7 items-center justify-center rounded-full bg-muted text-[10px] font-bold border-2 border-card">{pool.mintA.symbol?.[0]}</div>
                          )}
                          {pool.mintB.logoURI ? (
                            <img src={pool.mintB.logoURI} alt={pool.mintB.symbol} className="h-7 w-7 rounded-full border-2 border-card" />
                          ) : (
                            <div className="flex h-7 w-7 items-center justify-center rounded-full bg-muted text-[10px] font-bold border-2 border-card">{pool.mintB.symbol?.[0]}</div>
                          )}
                        </div>
                        <div>
                          <p className="font-medium text-sm">
                            {pool.mintA.symbol}/{pool.mintB.symbol}
                          </p>
                          <Badge
                            variant="outline"
                            className={cn(
                              "text-[10px] px-1.5 py-0 mt-0.5",
                              pool.type === "Concentrated"
                                ? "border-neon-purple/50 text-neon-purple"
                                : "border-primary/50 text-primary"
                            )}
                          >
                            {pool.type === "Concentrated" ? "CLMM" : "CPMM"}
                          </Badge>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="text-right font-mono text-sm">
                      ${formatNumber(pool.tvl)}
                    </TableCell>
                    <TableCell className="text-right font-mono text-sm text-muted-foreground hidden sm:table-cell">
                      ${formatNumber(pool.day.volume)}
                    </TableCell>
                    <TableCell className="text-right font-mono text-sm text-muted-foreground hidden md:table-cell">
                      ${formatNumber(pool.day.volumeFee)}
                    </TableCell>
                    <TableCell className="text-right">
                      <span className={cn(
                        "font-medium text-sm",
                        pool.day.apr > 100 ? "text-primary" : pool.day.apr > 20 ? "text-yellow-500" : "text-foreground"
                      )}>
                        {pool.day.apr.toFixed(1)}%
                      </span>
                    </TableCell>
                    <TableCell className="text-right text-sm text-muted-foreground hidden lg:table-cell">
                      {(pool.feeRate * 100).toFixed(2)}%
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        size="sm"
                        onClick={() => onSelectPool(pool)}
                        className="h-8 px-3 text-xs bg-primary text-primary-foreground hover:bg-primary/90 glow-green-sm"
                      >
                        + Liquidity
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
            {isError && (
              <TableRow>
                <TableCell colSpan={7} className="text-center py-12 text-muted-foreground">
                  Failed to load pools from Raydium.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      {/* Pagination */}
      {pools.length > 0 && (
        <div className="flex items-center justify-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1}>
            Previous
          </Button>
          <span className="text-sm text-muted-foreground">Page {page}</span>
          <Button variant="outline" size="sm" onClick={() => setPage((p) => p + 1)} disabled={!data?.hasNextPage}>
            Next
          </Button>
        </div>
      )}
    </div>
  );
}
