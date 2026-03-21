"use client";

import { useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { TradingViewWidget } from "@/components/charts/TradingViewWidget";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Search } from "lucide-react";
import { cn } from "@/lib/utils";

const POPULAR_PAIRS = [
  { label: "SOL/USD", symbol: "CRYPTO:SOLUSD" },
  { label: "SOL/USDT", symbol: "BINANCE:SOLUSDT" },
  { label: "BTC/USD", symbol: "CRYPTO:BTCUSD" },
  { label: "ETH/USD", symbol: "CRYPTO:ETHUSD" },
  { label: "BONK/USD", symbol: "CRYPTO:BONKUSD" },
  { label: "WIF/USD", symbol: "CRYPTO:WIFUSD" },
  { label: "JUP/USD", symbol: "CRYPTO:JUPUSD" },
  { label: "RAY/USD", symbol: "CRYPTO:RAYUSD" },
];

function ChartsContent() {
  const searchParams = useSearchParams();
  const symbolParam = searchParams.get("symbol");

  const [selectedPair, setSelectedPair] = useState(
    symbolParam || "CRYPTO:SOLUSD"
  );
  const [searchInput, setSearchInput] = useState("");

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (searchInput.trim()) {
      // Try to format as a TradingView symbol
      const input = searchInput.trim().toUpperCase();
      if (input.includes(":")) {
        setSelectedPair(input);
      } else if (input.includes("/")) {
        setSelectedPair(`CRYPTO:${input.replace("/", "")}`);
      } else {
        setSelectedPair(`CRYPTO:${input}USD`);
      }
      setSearchInput("");
    }
  };

  const currentLabel =
    POPULAR_PAIRS.find((p) => p.symbol === selectedPair)?.label ||
    selectedPair.replace("CRYPTO:", "").replace("BINANCE:", "");

  return (
    <div className="mx-auto w-full max-w-7xl px-4 pt-4 pb-16">
      <div className="mb-3">
        <h1 className="text-xl font-bold">
          <span className="text-gradient">Charts</span>
        </h1>
        <p className="text-xs text-muted-foreground">
          Full TradingView charts with indicators, drawing tools, and real-time
          data.
        </p>
      </div>

      <Card className="border-border/50 bg-card/80">
        <CardHeader>
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            {/* Current pair */}
            <div>
              <h2 className="text-xl font-bold">{currentLabel}</h2>
            </div>

            {/* Search */}
            <form onSubmit={handleSearch} className="relative max-w-xs">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search symbol (e.g. BONK, JUP/USD)"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                className="pl-10 bg-background border-border h-9 text-sm"
              />
            </form>
          </div>

          {/* Quick pair selector */}
          <div className="flex flex-wrap items-center gap-1.5 pt-2">
            {POPULAR_PAIRS.map((pair) => (
              <Button
                key={pair.symbol}
                variant="ghost"
                size="sm"
                onClick={() => setSelectedPair(pair.symbol)}
                className={cn(
                  "h-7 px-3 text-xs",
                  selectedPair === pair.symbol
                    ? "bg-primary/10 text-primary"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                {pair.label}
              </Button>
            ))}
          </div>
        </CardHeader>
        <CardContent>
          <TradingViewWidget symbol={selectedPair} />
        </CardContent>
      </Card>
    </div>
  );
}

export default function ChartsPage() {
  return (
    <Suspense>
      <ChartsContent />
    </Suspense>
  );
}
