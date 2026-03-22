"use client";

import { cn, formatNumber } from "@/lib/utils";

interface Market {
  label: string;
  symbol: string;
  base: string;
  quote: string;
}

interface MarketBarProps {
  market: Market;
}

// Static mock data — will be replaced with live feeds
const MOCK_STATS: Record<string, { price: string; change: string; changePct: string; volume: string; mcap: string }> = {
  SOL: { price: "143.46", change: "-0.84", changePct: "-0.59%", volume: "2,847,302,145", mcap: "69,420,000,000" },
  BTC: { price: "67,234.50", change: "+1,234.50", changePct: "+1.87%", volume: "28,473,021,450", mcap: "1,320,000,000,000" },
  ETH: { price: "3,456.78", change: "-45.32", changePct: "-1.29%", volume: "12,847,302,145", mcap: "415,000,000,000" },
  BONK: { price: "0.00002134", change: "+0.00000045", changePct: "+2.15%", volume: "284,730,214", mcap: "1,420,000,000" },
  WIF: { price: "2.34", change: "+0.12", changePct: "+5.41%", volume: "847,302,145", mcap: "2,340,000,000" },
  JUP: { price: "0.82", change: "-0.03", changePct: "-3.53%", volume: "184,730,214", mcap: "1,120,000,000" },
  RAY: { price: "0.62", change: "+0.01", changePct: "+0.51%", volume: "15,200,000", mcap: "166,530,000" },
};

export function MarketBar({ market }: MarketBarProps) {
  const stats = MOCK_STATS[market.base] || MOCK_STATS.SOL;
  const isPositive = stats.changePct.startsWith("+");

  return (
    <div className="flex items-center gap-6 border-b border-border/50 bg-card/50 px-4 h-12 shrink-0 overflow-x-auto">
      {/* Pair name */}
      <div className="flex items-center gap-2 shrink-0">
        <span className="text-sm font-bold">{market.label}</span>
      </div>

      {/* Price */}
      <div className="shrink-0">
        <p className="text-[10px] text-muted-foreground leading-none">Price</p>
        <p className={cn("text-sm font-mono font-semibold leading-tight", isPositive ? "text-primary" : "text-destructive")}>
          {stats.price}
        </p>
      </div>

      {/* 24h Change */}
      <div className="shrink-0">
        <p className="text-[10px] text-muted-foreground leading-none">24h Change</p>
        <p className={cn("text-sm font-mono leading-tight", isPositive ? "text-primary" : "text-destructive")}>
          {stats.change} / {stats.changePct}
        </p>
      </div>

      {/* 24h Volume */}
      <div className="shrink-0">
        <p className="text-[10px] text-muted-foreground leading-none">24h Volume</p>
        <p className="text-sm font-mono text-foreground leading-tight">{stats.volume} {market.quote}</p>
      </div>

      {/* Market Cap */}
      <div className="shrink-0">
        <p className="text-[10px] text-muted-foreground leading-none">Market Cap</p>
        <p className="text-sm font-mono text-foreground leading-tight">{stats.mcap}</p>
      </div>
    </div>
  );
}
