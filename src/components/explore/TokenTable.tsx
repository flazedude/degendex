"use client";

import { useState } from "react";
import Link from "next/link";
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
import { formatNumber, formatUSD } from "@/lib/utils";
import { cn } from "@/lib/utils";

export function TokenTable() {
  const [sortBy, setSortBy] = useState<"v24hUSD" | "mc" | "v24hChangePercent">("v24hUSD");
  const [page, setPage] = useState(0);
  const limit = 20;

  const { data, isLoading, isError } = useTokenList(sortBy, "desc", page * limit, limit);
  const tokens = data?.tokens || [];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <TokenFilters sortBy={sortBy} onSortChange={(s) => { setSortBy(s); setPage(0); }} />
        <p className="text-xs text-muted-foreground">
          {data?.total ? `${data.total.toLocaleString()} tokens` : ""}
        </p>
      </div>

      <div className="rounded-lg border border-border/50 bg-card/50">
        <Table>
          <TableHeader>
            <TableRow className="border-border/50 hover:bg-transparent">
              <TableHead className="w-12 text-muted-foreground">#</TableHead>
              <TableHead className="text-muted-foreground">Token</TableHead>
              <TableHead className="text-right text-muted-foreground">Price</TableHead>
              <TableHead className="text-right text-muted-foreground">24h %</TableHead>
              <TableHead className="text-right text-muted-foreground hidden sm:table-cell">Volume 24h</TableHead>
              <TableHead className="text-right text-muted-foreground hidden md:table-cell">Market Cap</TableHead>
              <TableHead className="text-right text-muted-foreground hidden lg:table-cell">Liquidity</TableHead>
              <TableHead className="w-20" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading
              ? Array.from({ length: 10 }).map((_, i) => (
                  <TableRow key={i} className="border-border/30">
                    <TableCell><Skeleton className="h-4 w-6" /></TableCell>
                    <TableCell><div className="flex items-center gap-3"><Skeleton className="h-8 w-8 rounded-full" /><Skeleton className="h-4 w-24" /></div></TableCell>
                    <TableCell><Skeleton className="ml-auto h-4 w-16" /></TableCell>
                    <TableCell><Skeleton className="ml-auto h-4 w-14" /></TableCell>
                    <TableCell className="hidden sm:table-cell"><Skeleton className="ml-auto h-4 w-16" /></TableCell>
                    <TableCell className="hidden md:table-cell"><Skeleton className="ml-auto h-4 w-16" /></TableCell>
                    <TableCell className="hidden lg:table-cell"><Skeleton className="ml-auto h-4 w-16" /></TableCell>
                    <TableCell><Skeleton className="ml-auto h-8 w-14" /></TableCell>
                  </TableRow>
                ))
              : tokens.map((token, i) => {
                  const isPositive = token.priceChange24hPercent >= 0;
                  return (
                    <TableRow
                      key={token.address}
                      className="border-border/30 hover:bg-muted/30 cursor-pointer transition-colors"
                    >
                      <TableCell className="text-muted-foreground text-sm">
                        {page * limit + i + 1}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-3">
                          {token.logoURI ? (
                            <img
                              src={token.logoURI}
                              alt={token.symbol}
                              className="h-8 w-8 rounded-full"
                            />
                          ) : (
                            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-muted text-xs font-bold">
                              {token.symbol?.[0] || "?"}
                            </div>
                          )}
                          <div>
                            <p className="font-medium text-sm">{token.symbol}</p>
                            <p className="text-xs text-muted-foreground truncate max-w-[120px]">
                              {token.name}
                            </p>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="text-right font-mono text-sm">
                        {token.price < 0.01
                          ? `$${token.price.toFixed(8)}`
                          : formatUSD(token.price)}
                      </TableCell>
                      <TableCell className="text-right">
                        <span
                          className={cn(
                            "inline-flex items-center gap-0.5 text-sm font-medium",
                            isPositive ? "text-primary" : "text-destructive"
                          )}
                        >
                          {isPositive ? (
                            <ArrowUpRight className="h-3.5 w-3.5" />
                          ) : (
                            <ArrowDownRight className="h-3.5 w-3.5" />
                          )}
                          {Math.abs(token.priceChange24hPercent).toFixed(2)}%
                        </span>
                      </TableCell>
                      <TableCell className="text-right text-sm text-muted-foreground hidden sm:table-cell">
                        ${formatNumber(token.volume24hUSD)}
                      </TableCell>
                      <TableCell className="text-right text-sm text-muted-foreground hidden md:table-cell">
                        ${formatNumber(token.marketCap)}
                      </TableCell>
                      <TableCell className="text-right text-sm text-muted-foreground hidden lg:table-cell">
                        ${formatNumber(token.liquidity)}
                      </TableCell>
                      <TableCell className="text-right">
                        <Link href={`/charts?token=${token.address}`}>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-xs text-muted-foreground hover:text-primary"
                          >
                            <ExternalLink className="h-3.5 w-3.5" />
                          </Button>
                        </Link>
                      </TableCell>
                    </TableRow>
                  );
                })}
            {isError && (
              <TableRow>
                <TableCell colSpan={8} className="text-center py-12 text-muted-foreground">
                  Failed to load tokens. Check your Birdeye API key in .env.local
                </TableCell>
              </TableRow>
            )}
            {!isLoading && !isError && tokens.length === 0 && (
              <TableRow>
                <TableCell colSpan={8} className="text-center py-12 text-muted-foreground">
                  No tokens found
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      {/* Pagination */}
      {tokens.length > 0 && (
        <div className="flex items-center justify-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            disabled={page === 0}
          >
            Previous
          </Button>
          <span className="text-sm text-muted-foreground">
            Page {page + 1}
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPage((p) => p + 1)}
            disabled={tokens.length < limit}
          >
            Next
          </Button>
        </div>
      )}
    </div>
  );
}
