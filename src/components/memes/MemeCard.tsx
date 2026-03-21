"use client";

import { ArrowUpRight, ArrowDownRight, Clock, Droplets } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn, formatNumber } from "@/lib/utils";
import type { DexScreenerPair } from "@/lib/api/dexscreener";
import { formatDistanceToNow } from "date-fns";

interface MemeCardProps {
  pair: DexScreenerPair;
  onClick: () => void;
}

export function MemeCard({ pair, onClick }: MemeCardProps) {
  const priceChange5m = pair.priceChange?.m5 ?? 0;
  const priceChange1h = pair.priceChange?.h1 ?? 0;
  const priceChange24h = pair.priceChange?.h24 ?? 0;
  const isPositive5m = priceChange5m >= 0;
  const age = pair.pairCreatedAt
    ? formatDistanceToNow(new Date(pair.pairCreatedAt), { addSuffix: false })
    : "Unknown";

  return (
    <Card
      className="border-border/50 bg-card/80 overflow-hidden transition-all hover:border-primary/30 cursor-pointer group"
      onClick={onClick}
    >
      <CardContent className="p-3 space-y-2">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 min-w-0">
            {pair.info?.imageUrl ? (
              <img
                src={pair.info.imageUrl}
                alt={pair.baseToken.symbol}
                className="h-8 w-8 rounded-full shrink-0"
              />
            ) : (
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-muted text-xs font-bold shrink-0">
                {pair.baseToken.symbol?.[0] || "?"}
              </div>
            )}
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <h3 className="font-bold text-sm truncate">{pair.baseToken.symbol}</h3>
                {pair.dexId === "pumpfun" && (
                  <Badge variant="outline" className="border-neon-pink/50 text-neon-pink text-[10px] px-1 py-0 leading-tight">
                    pump.fun
                  </Badge>
                )}
                {pair.dexId === "raydium" && (
                  <Badge variant="outline" className="border-neon-purple/50 text-neon-purple text-[10px] px-1 py-0 leading-tight">
                    raydium
                  </Badge>
                )}
              </div>
              <p className="text-[11px] text-muted-foreground truncate">{pair.baseToken.name}</p>
            </div>
          </div>

          <div className="text-right shrink-0">
            <p className="font-mono text-sm font-semibold">
              {pair.priceUsd
                ? parseFloat(pair.priceUsd) < 0.0001
                  ? `$${parseFloat(pair.priceUsd).toExponential(2)}`
                  : `$${parseFloat(pair.priceUsd).toFixed(
                      parseFloat(pair.priceUsd) < 1 ? 6 : 2
                    )}`
                : "N/A"}
            </p>
            <span
              className={cn(
                "inline-flex items-center gap-0.5 text-[11px] font-medium",
                isPositive5m ? "text-primary" : "text-destructive"
              )}
            >
              {isPositive5m ? (
                <ArrowUpRight className="h-3 w-3" />
              ) : (
                <ArrowDownRight className="h-3 w-3" />
              )}
              {Math.abs(priceChange5m).toFixed(1)}% <span className="text-muted-foreground font-normal">5m</span>
            </span>
          </div>
        </div>

        {/* Stats Row */}
        <div className="grid grid-cols-4 gap-1">
          <div className="text-center">
            <p className="text-[10px] text-muted-foreground">1h</p>
            <p className={cn("text-[11px] font-medium", priceChange1h >= 0 ? "text-primary" : "text-destructive")}>
              {priceChange1h >= 0 ? "+" : ""}{priceChange1h.toFixed(1)}%
            </p>
          </div>
          <div className="text-center">
            <p className="text-[10px] text-muted-foreground">24h</p>
            <p className={cn("text-[11px] font-medium", priceChange24h >= 0 ? "text-primary" : "text-destructive")}>
              {priceChange24h >= 0 ? "+" : ""}{priceChange24h.toFixed(1)}%
            </p>
          </div>
          <div className="text-center">
            <p className="text-[10px] text-muted-foreground">Vol</p>
            <p className="text-[11px] font-medium">${formatNumber(pair.volume?.h24 ?? 0)}</p>
          </div>
          <div className="text-center">
            <p className="text-[10px] text-muted-foreground">MCap</p>
            <p className="text-[11px] font-medium">
              {pair.marketCap ? `$${formatNumber(pair.marketCap)}` : "N/A"}
            </p>
          </div>
        </div>

        {/* Footer meta */}
        <div className="flex items-center gap-3 text-[10px] text-muted-foreground pt-1 border-t border-border/30">
          <span className="flex items-center gap-1">
            <Clock className="h-2.5 w-2.5" />
            {age}
          </span>
          <span className="flex items-center gap-1">
            <Droplets className="h-2.5 w-2.5" />
            ${formatNumber(pair.liquidity?.usd ?? 0)}
          </span>
        </div>
      </CardContent>
    </Card>
  );
}
