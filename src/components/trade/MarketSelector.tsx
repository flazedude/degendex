"use client";

import { useState } from "react";
import { Search } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Market } from "@/app/trade/page";

interface MarketSelectorProps {
  markets: Market[];
  selected: Market;
  onSelect: (market: Market) => void;
}

const CATEGORIES: { key: Market["category"]; label: string }[] = [
  { key: "solana", label: "Solana" },
  { key: "major", label: "Majors" },
  { key: "l1", label: "L1/L2" },
  { key: "defi", label: "DeFi" },
  { key: "meme", label: "Memes" },
];

export function MarketSelector({ markets, selected, onSelect }: MarketSelectorProps) {
  const [search, setSearch] = useState("");
  const [activeCategory, setActiveCategory] = useState<Market["category"] | "all">("all");

  const filtered = markets.filter((m) => {
    const matchesSearch = !search || m.label.toLowerCase().includes(search.toLowerCase()) || m.base.toLowerCase().includes(search.toLowerCase());
    const matchesCategory = activeCategory === "all" || m.category === activeCategory;
    return matchesSearch && matchesCategory;
  });

  // Group by category
  const grouped = CATEGORIES.reduce<Record<string, Market[]>>((acc, cat) => {
    const items = filtered.filter((m) => m.category === cat.key);
    if (items.length > 0) acc[cat.key] = items;
    return acc;
  }, {});

  return (
    <div className="flex flex-col h-full">
      {/* Search */}
      <div className="p-1.5 border-b border-border/30">
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full bg-background border border-border/50 pl-6 pr-2 py-1 text-[11px] outline-none focus:border-primary/50"
          />
        </div>
      </div>

      {/* Category tabs */}
      <div className="flex flex-wrap gap-0.5 px-1.5 py-1 border-b border-border/30">
        <button
          onClick={() => setActiveCategory("all")}
          className={cn(
            "px-1.5 py-0.5 text-[10px] font-medium transition-colors",
            activeCategory === "all" ? "text-primary bg-primary/10" : "text-muted-foreground hover:text-foreground"
          )}
        >
          All
        </button>
        {CATEGORIES.map((cat) => (
          <button
            key={cat.key}
            onClick={() => setActiveCategory(cat.key)}
            className={cn(
              "px-1.5 py-0.5 text-[10px] font-medium transition-colors",
              activeCategory === cat.key ? "text-primary bg-primary/10" : "text-muted-foreground hover:text-foreground"
            )}
          >
            {cat.label}
          </button>
        ))}
      </div>

      {/* Markets list */}
      <div className="flex-1 overflow-y-auto">
        {activeCategory === "all" ? (
          Object.entries(grouped).map(([catKey, items]) => {
            const catLabel = CATEGORIES.find((c) => c.key === catKey)?.label || catKey;
            return (
              <div key={catKey}>
                <div className="px-2 py-1 text-[9px] font-medium text-muted-foreground uppercase tracking-wider bg-background/50 sticky top-0">
                  {catLabel}
                </div>
                {items.map((market) => (
                  <MarketRow key={market.symbol} market={market} selected={selected} onSelect={onSelect} />
                ))}
              </div>
            );
          })
        ) : (
          filtered.map((market) => (
            <MarketRow key={market.symbol} market={market} selected={selected} onSelect={onSelect} />
          ))
        )}
        {filtered.length === 0 && (
          <div className="px-2 py-4 text-[11px] text-muted-foreground text-center">No markets found</div>
        )}
      </div>
    </div>
  );
}

function MarketRow({ market, selected, onSelect }: { market: Market; selected: Market; onSelect: (m: Market) => void }) {
  return (
    <button
      onClick={() => onSelect(market)}
      className={cn(
        "w-full text-left px-2 py-1 text-[11px] font-mono transition-colors hover:bg-muted/50 flex items-center justify-between",
        selected.symbol === market.symbol
          ? "bg-primary/10 text-primary border-l-2 border-primary"
          : "text-muted-foreground border-l-2 border-transparent"
      )}
    >
      <span>{market.base}</span>
      <span className="text-[9px] text-muted-foreground">{market.quote}</span>
    </button>
  );
}
