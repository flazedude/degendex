"use client";

import { ExternalLink, ArrowUpRight, ArrowDownRight, Clock, Droplets, BarChart3 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn, formatNumber, shortenAddress } from "@/lib/utils";
import { getDexScreenerChartEmbed, getDexScreenerChartUrl, type DexScreenerPair } from "@/lib/api/dexscreener";
import Link from "next/link";
import { formatDistanceToNow } from "date-fns";

interface MemeCardProps {
  pair: DexScreenerPair;
}

export function MemeCard({ pair }: MemeCardProps) {
  const priceChange5m = pair.priceChange?.m5 ?? 0;
  const priceChange1h = pair.priceChange?.h1 ?? 0;
  const priceChange24h = pair.priceChange?.h24 ?? 0;
  const isPositive5m = priceChange5m >= 0;
  const age = pair.pairCreatedAt
    ? formatDistanceToNow(new Date(pair.pairCreatedAt), { addSuffix: false })
    : "Unknown";

  return (
    <Card className="border-border/50 bg-card/80 overflow-hidden transition-all hover:border-primary/30 group">
      <CardContent className="p-0">
        {/* Header */}
        <div className="flex items-start justify-between p-4 pb-2">
          <div className="flex items-center gap-3 min-w-0">
            {pair.info?.imageUrl ? (
              <img
                src={pair.info.imageUrl}
                alt={pair.baseToken.symbol}
                className="h-10 w-10 rounded-full shrink-0"
              />
            ) : (
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-muted text-sm font-bold shrink-0">
                {pair.baseToken.symbol?.[0] || "?"}
              </div>
            )}
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h3 className="font-bold text-sm truncate">{pair.baseToken.symbol}</h3>
                {pair.dexId === "pumpfun" && (
                  <Badge variant="outline" className="border-neon-pink/50 text-neon-pink text-[10px] px-1.5 py-0">
                    pump.fun
                  </Badge>
                )}
                {pair.dexId === "raydium" && (
                  <Badge variant="outline" className="border-neon-purple/50 text-neon-purple text-[10px] px-1.5 py-0">
                    raydium
                  </Badge>
                )}
              </div>
              <p className="text-xs text-muted-foreground truncate">{pair.baseToken.name}</p>
            </div>
          </div>

          {/* Price */}
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
                "inline-flex items-center gap-0.5 text-xs font-medium",
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

        {/* DexScreener Chart Embed */}
        <div className="mx-4 mb-2 h-[200px] rounded-lg overflow-hidden border border-border/30">
          <iframe
            src={getDexScreenerChartEmbed(pair.pairAddress)}
            className="h-full w-full"
            title={`${pair.baseToken.symbol} chart`}
          />
        </div>

        {/* Stats Row */}
        <div className="grid grid-cols-4 gap-1 px-4 pb-2">
          <div className="text-center">
            <p className="text-[10px] text-muted-foreground">1h</p>
            <p className={cn("text-xs font-medium", priceChange1h >= 0 ? "text-primary" : "text-destructive")}>
              {priceChange1h >= 0 ? "+" : ""}{priceChange1h.toFixed(1)}%
            </p>
          </div>
          <div className="text-center">
            <p className="text-[10px] text-muted-foreground">24h</p>
            <p className={cn("text-xs font-medium", priceChange24h >= 0 ? "text-primary" : "text-destructive")}>
              {priceChange24h >= 0 ? "+" : ""}{priceChange24h.toFixed(1)}%
            </p>
          </div>
          <div className="text-center">
            <p className="text-[10px] text-muted-foreground">Vol 24h</p>
            <p className="text-xs font-medium">${formatNumber(pair.volume?.h24 ?? 0)}</p>
          </div>
          <div className="text-center">
            <p className="text-[10px] text-muted-foreground">MCap</p>
            <p className="text-xs font-medium">
              {pair.marketCap ? `$${formatNumber(pair.marketCap)}` : "N/A"}
            </p>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-border/30 px-4 py-2">
          <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
            <span className="flex items-center gap-1">
              <Clock className="h-3 w-3" />
              {age}
            </span>
            <span className="flex items-center gap-1">
              <Droplets className="h-3 w-3" />
              ${formatNumber(pair.liquidity?.usd ?? 0)}
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            <Link href={`/swap`}>
              <Button size="sm" className="h-7 px-3 text-xs bg-primary text-primary-foreground hover:bg-primary/90 glow-green-sm">
                Swap
              </Button>
            </Link>
            <a
              href={getDexScreenerChartUrl(pair.pairAddress)}
              target="_blank"
              rel="noopener noreferrer"
            >
              <Button variant="ghost" size="sm" className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground">
                <ExternalLink className="h-3.5 w-3.5" />
              </Button>
            </a>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
