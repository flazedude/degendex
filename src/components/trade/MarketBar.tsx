"use client";

import { cn } from "@/lib/utils";
import type { Market } from "@/app/trade/page";

interface MarketBarProps {
  market: Market;
}

export function MarketBar({ market }: MarketBarProps) {
  return (
    <div className="flex items-center gap-6 border-b border-border/50 bg-card/50 px-4 h-12 shrink-0 overflow-x-auto">
      <div className="flex items-center gap-2 shrink-0">
        <span className="text-sm font-bold">{market.label}</span>
        <span className={cn(
          "text-[9px] px-1 py-px font-medium",
          market.category === "meme" ? "bg-secondary/20 text-secondary" :
          market.category === "solana" ? "bg-primary/20 text-primary" :
          "bg-muted text-muted-foreground"
        )}>
          {market.category.toUpperCase()}
        </span>
      </div>

      <div className="shrink-0">
        <p className="text-[10px] text-muted-foreground leading-none">Base</p>
        <p className="text-sm font-mono font-semibold leading-tight">{market.base}</p>
      </div>

      <div className="shrink-0">
        <p className="text-[10px] text-muted-foreground leading-none">Quote</p>
        <p className="text-sm font-mono leading-tight">{market.quote}</p>
      </div>

      <div className="shrink-0">
        <p className="text-[10px] text-muted-foreground leading-none">Source</p>
        <p className="text-sm font-mono leading-tight text-muted-foreground">
          {market.symbol.split(":")[0]}
        </p>
      </div>
    </div>
  );
}
