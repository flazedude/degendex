"use client";

import { useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { TradingViewWidget } from "@/components/charts/TradingViewWidget";
import { TradePanel } from "@/components/trade/TradePanel";
import { MarketBar } from "@/components/trade/MarketBar";
import { MarketSelector } from "@/components/trade/MarketSelector";
import { RecentTrades } from "@/components/trade/RecentTrades";
import { OrderBook } from "@/components/trade/OrderBook";

const MARKETS = [
  { label: "SOL/USD", symbol: "CRYPTO:SOLUSD", base: "SOL", quote: "USD" },
  { label: "SOL/USDT", symbol: "BINANCE:SOLUSDT", base: "SOL", quote: "USDT" },
  { label: "BTC/USD", symbol: "CRYPTO:BTCUSD", base: "BTC", quote: "USD" },
  { label: "ETH/USD", symbol: "CRYPTO:ETHUSD", base: "ETH", quote: "USD" },
  { label: "BONK/USD", symbol: "CRYPTO:BONKUSD", base: "BONK", quote: "USD" },
  { label: "WIF/USD", symbol: "CRYPTO:WIFUSD", base: "WIF", quote: "USD" },
  { label: "JUP/USD", symbol: "CRYPTO:JUPUSD", base: "JUP", quote: "USD" },
  { label: "RAY/USD", symbol: "CRYPTO:RAYUSD", base: "RAY", quote: "USD" },
];

function TradeContent() {
  const searchParams = useSearchParams();
  const symbolParam = searchParams.get("symbol");

  const [selectedMarket, setSelectedMarket] = useState(
    MARKETS.find((m) => m.symbol === symbolParam) || MARKETS[0]
  );

  return (
    <div className="flex flex-col h-[calc(100vh-40px)] overflow-hidden">
      {/* Top market bar */}
      <MarketBar market={selectedMarket} />

      {/* Main grid */}
      <div className="flex flex-1 min-h-0">
        {/* Left: Market selector */}
        <div className="w-48 border-r border-border/50 overflow-y-auto hidden lg:block">
          <MarketSelector
            markets={MARKETS}
            selected={selectedMarket}
            onSelect={setSelectedMarket}
          />
        </div>

        {/* Center: Chart */}
        <div className="flex-1 flex flex-col min-w-0">
          <div className="flex-1 min-h-0">
            <TradingViewWidget symbol={selectedMarket.symbol} />
          </div>
          {/* Bottom: Recent trades */}
          <div className="h-48 border-t border-border/50 overflow-hidden">
            <RecentTrades market={selectedMarket} />
          </div>
        </div>

        {/* Right: Order book + Trade panel */}
        <div className="w-72 border-l border-border/50 flex flex-col hidden md:flex">
          <div className="flex-1 overflow-y-auto border-b border-border/50">
            <OrderBook market={selectedMarket} />
          </div>
          <div className="shrink-0">
            <TradePanel market={selectedMarket} />
          </div>
        </div>
      </div>
    </div>
  );
}

export default function TradePage() {
  return (
    <Suspense>
      <TradeContent />
    </Suspense>
  );
}
