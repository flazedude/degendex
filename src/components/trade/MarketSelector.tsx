"use client";

import { cn } from "@/lib/utils";

interface Market {
  label: string;
  symbol: string;
  base: string;
  quote: string;
}

interface MarketSelectorProps {
  markets: Market[];
  selected: Market;
  onSelect: (market: Market) => void;
}

export function MarketSelector({ markets, selected, onSelect }: MarketSelectorProps) {
  return (
    <div className="py-1">
      <div className="px-3 py-1.5 text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
        Markets
      </div>
      {markets.map((market) => (
        <button
          key={market.symbol}
          onClick={() => onSelect(market)}
          className={cn(
            "w-full text-left px-3 py-1.5 text-xs font-mono transition-colors hover:bg-muted/50",
            selected.symbol === market.symbol
              ? "bg-primary/10 text-primary border-l-2 border-primary"
              : "text-muted-foreground border-l-2 border-transparent"
          )}
        >
          {market.label}
        </button>
      ))}
    </div>
  );
}
