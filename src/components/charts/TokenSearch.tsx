"use client";

import { useState } from "react";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { SOL_MINT, USDC_MINT } from "@/lib/constants";

interface TokenSearchProps {
  onSelect: (address: string, symbol?: string) => void;
}

const QUICK_TOKENS = [
  { symbol: "SOL", address: SOL_MINT },
  { symbol: "USDC", address: USDC_MINT },
];

export function TokenSearch({ onSelect }: TokenSearchProps) {
  const [search, setSearch] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (search.trim().length > 30) {
      onSelect(search.trim());
      setSearch("");
    }
  };

  return (
    <div className="flex items-center gap-3">
      <form onSubmit={handleSubmit} className="relative flex-1 max-w-xs">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Paste token address..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-10 bg-background border-border h-9 text-sm"
        />
      </form>
      <div className="flex items-center gap-1">
        {QUICK_TOKENS.map((t) => (
          <button
            key={t.address}
            onClick={() => onSelect(t.address, t.symbol)}
            className="rounded-full border border-border bg-muted/50 px-3 py-1 text-xs font-medium transition-colors hover:border-primary/50 hover:bg-primary/10"
          >
            {t.symbol}
          </button>
        ))}
      </div>
    </div>
  );
}
