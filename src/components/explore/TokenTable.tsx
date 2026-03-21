"use client";

import { useState } from "react";
import { ArrowUpRight, ArrowDownRight, ExternalLink } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useTokenList } from "@/hooks/useTokenList";
import { TokenFilters } from "./TokenFilters";
import { formatNumber } from "@/lib/utils";
import { cn } from "@/lib/utils";
import { getDexScreenerChartUrl } from "@/lib/api/dexscreener";

export function TokenTable() {
  const [sortBy, setSortBy] = useState<"volume" | "liquidity" | "priceChange">("volume");

  const { data, isLoading, isError } = useTokenList(sortBy, "desc");
  const pairs = data?.pairs || [];

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <TokenFilters sortBy={sortBy} onSortChange={setSortBy} />
        <p className="text-[11px] text-muted-foreground">
          {pairs.length > 0 ? `${pairs.length} pairs` : ""}
        </p>
      </div>

      <div className="border border-border/50 bg-card/50">
        <Table>
          <TableHeader>
            <TableRow className="border-border/50 hover:bg-transparent">
              <TableHead className="w-10 text-muted-foreground">#</TableHead>
              <TableHead className="text-muted-foreground">Token</TableHead>
              <TableHead className="text-right text-muted-foreground">Price</TableHead>
              <TableHead className="text-right text-muted-foreground">24h %</TableHead>
              <TableHead className="text-right text-muted-foreground hidden sm:table-cell">Vol 24h</TableHead>
              <TableHead className="text-right text-muted-foreground hidden md:table-cell">MCap</TableHead>
              <TableHead className="text-right text-muted-foreground hidden lg:table-cell">Liquidity</TableHead>
              <TableHead className="w-10" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading
              ? Array.from({ length: 10 }).map((_, i) => (
                  <TableRow key={i} className="border-border/30">
                    <TableCell><Skeleton className="h-4 w-5" /></TableCell>
                    <TableCell><div className="flex items-center gap-2"><Skeleton className="h-7 w-7 rounded-full" /><Skeleton className="h-4 w-20" /></div></TableCell>
                    <TableCell><Skeleton className="ml-auto h-4 w-14" /></TableCell>
                    <TableCell><Skeleton className="ml-auto h-4 w-12" /></TableCell>
                    <TableCell className="hidden sm:table-cell"><Skeleton className="ml-auto h-4 w-14" /></TableCell>
                    <TableCell className="hidden md:table-cell"><Skeleton className="ml-auto h-4 w-14" /></TableCell>
                    <TableCell className="hidden lg:table-cell"><Skeleton className="ml-auto h-4 w-14" /></TableCell>
                    <TableCell><Skeleton className="ml-auto h-6 w-6" /></TableCell>
                  </TableRow>
                ))
              : pairs.map((pair, i) => {
                  const priceChange = pair.priceChange?.h24 ?? 0;
                  const isPositive = priceChange >= 0;
                  const price = pair.priceUsd ? parseFloat(pair.priceUsd) : 0;
                  return (
                    <TableRow
                      key={pair.pairAddress}
                      className="border-border/30 hover:bg-muted/30 transition-colors"
                    >
                      <TableCell className="text-muted-foreground text-xs">
                        {i + 1}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          {pair.info?.imageUrl ? (
                            <img
                              src={pair.info.imageUrl}
                              alt={pair.baseToken.symbol}
                              className="h-7 w-7 rounded-full"
                            />
                          ) : (
                            <div className="flex h-7 w-7 items-center justify-center rounded-full bg-muted text-[10px] font-bold">
                              {pair.baseToken.symbol?.[0] || "?"}
                            </div>
                          )}
                          <div>
                            <p className="font-medium text-sm">{pair.baseToken.symbol}</p>
                            <p className="text-[11px] text-muted-foreground truncate max-w-[100px]">
                              {pair.baseToken.name}
                            </p>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="text-right font-mono text-sm">
                        {price < 0.0001
                          ? `$${price.toExponential(2)}`
                          : price < 1
                          ? `$${price.toFixed(6)}`
                          : `$${price.toFixed(2)}`}
                      </TableCell>
                      <TableCell className="text-right">
                        <span
                          className={cn(
                            "inline-flex items-center gap-0.5 text-xs font-medium",
                            isPositive ? "text-primary" : "text-destructive"
                          )}
                        >
                          {isPositive ? (
                            <ArrowUpRight className="h-3 w-3" />
                          ) : (
                            <ArrowDownRight className="h-3 w-3" />
                          )}
                          {Math.abs(priceChange).toFixed(2)}%
                        </span>
                      </TableCell>
                      <TableCell className="text-right text-sm text-muted-foreground hidden sm:table-cell">
                        ${formatNumber(pair.volume?.h24 ?? 0)}
                      </TableCell>
                      <TableCell className="text-right text-sm text-muted-foreground hidden md:table-cell">
                        {pair.marketCap ? `$${formatNumber(pair.marketCap)}` : "—"}
                      </TableCell>
                      <TableCell className="text-right text-sm text-muted-foreground hidden lg:table-cell">
                        ${formatNumber(pair.liquidity?.usd ?? 0)}
                      </TableCell>
                      <TableCell className="text-right">
                        <a
                          href={getDexScreenerChartUrl(pair.pairAddress)}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-6 w-6 p-0 text-muted-foreground hover:text-primary"
                          >
                            <ExternalLink className="h-3.5 w-3.5" />
                          </Button>
                        </a>
                      </TableCell>
                    </TableRow>
                  );
                })}
            {isError && (
              <TableRow>
                <TableCell colSpan={8} className="text-center py-8 text-muted-foreground text-sm">
                  Failed to load tokens from DexScreener.
                </TableCell>
              </TableRow>
            )}
            {!isLoading && !isError && pairs.length === 0 && (
              <TableRow>
                <TableCell colSpan={8} className="text-center py-8 text-muted-foreground text-sm">
                  No tokens found
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
