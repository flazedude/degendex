"use client";

import { useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { TradingViewWidget } from "@/components/charts/TradingViewWidget";
import { TradePanel } from "@/components/trade/TradePanel";
import { MarketBar } from "@/components/trade/MarketBar";
import { MarketSelector } from "@/components/trade/MarketSelector";
import { RecentTrades } from "@/components/trade/RecentTrades";
import { OrderBook } from "@/components/trade/OrderBook";

export interface Market {
  label: string;
  symbol: string;
  base: string;
  quote: string;
  category: "solana" | "major" | "defi" | "meme" | "l1";
}

const MARKETS: Market[] = [
  // Solana ecosystem
  { label: "SOL/USD", symbol: "CRYPTO:SOLUSD", base: "SOL", quote: "USD", category: "solana" },
  { label: "SOL/USDT", symbol: "BINANCE:SOLUSDT", base: "SOL", quote: "USDT", category: "solana" },
  { label: "JUP/USD", symbol: "CRYPTO:JUPUSD", base: "JUP", quote: "USD", category: "solana" },
  { label: "RAY/USD", symbol: "CRYPTO:RAYUSD", base: "RAY", quote: "USD", category: "solana" },
  { label: "PYTH/USD", symbol: "CRYPTO:PYTHUSD", base: "PYTH", quote: "USD", category: "solana" },
  { label: "JTO/USD", symbol: "CRYPTO:JTOUSD", base: "JTO", quote: "USD", category: "solana" },
  { label: "HNT/USD", symbol: "CRYPTO:HNTUSD", base: "HNT", quote: "USD", category: "solana" },
  { label: "RNDR/USD", symbol: "CRYPTO:RNDRUSD", base: "RNDR", quote: "USD", category: "solana" },
  { label: "W/USD", symbol: "CRYPTO:WUSD", base: "W", quote: "USD", category: "solana" },
  { label: "ORCA/USD", symbol: "CRYPTO:ORCAUSD", base: "ORCA", quote: "USD", category: "solana" },

  // Majors
  { label: "BTC/USD", symbol: "CRYPTO:BTCUSD", base: "BTC", quote: "USD", category: "major" },
  { label: "BTC/USDT", symbol: "BINANCE:BTCUSDT", base: "BTC", quote: "USDT", category: "major" },
  { label: "ETH/USD", symbol: "CRYPTO:ETHUSD", base: "ETH", quote: "USD", category: "major" },
  { label: "ETH/USDT", symbol: "BINANCE:ETHUSDT", base: "ETH", quote: "USDT", category: "major" },
  { label: "BNB/USD", symbol: "CRYPTO:BNBUSD", base: "BNB", quote: "USD", category: "major" },
  { label: "XRP/USD", symbol: "CRYPTO:XRPUSD", base: "XRP", quote: "USD", category: "major" },
  { label: "ADA/USD", symbol: "CRYPTO:ADAUSD", base: "ADA", quote: "USD", category: "major" },
  { label: "DOGE/USD", symbol: "CRYPTO:DOGEUSD", base: "DOGE", quote: "USD", category: "major" },
  { label: "TON/USD", symbol: "CRYPTO:TONUSD", base: "TON", quote: "USD", category: "major" },
  { label: "TRX/USD", symbol: "CRYPTO:TRXUSD", base: "TRX", quote: "USD", category: "major" },

  // L1/L2
  { label: "AVAX/USD", symbol: "CRYPTO:AVAXUSD", base: "AVAX", quote: "USD", category: "l1" },
  { label: "SUI/USD", symbol: "CRYPTO:SUIUSD", base: "SUI", quote: "USD", category: "l1" },
  { label: "APT/USD", symbol: "CRYPTO:APTUSD", base: "APT", quote: "USD", category: "l1" },
  { label: "SEI/USD", symbol: "CRYPTO:SEIUSD", base: "SEI", quote: "USD", category: "l1" },
  { label: "NEAR/USD", symbol: "CRYPTO:NEARUSD", base: "NEAR", quote: "USD", category: "l1" },
  { label: "FTM/USD", symbol: "CRYPTO:FTMUSD", base: "FTM", quote: "USD", category: "l1" },
  { label: "ARB/USD", symbol: "CRYPTO:ARBUSD", base: "ARB", quote: "USD", category: "l1" },
  { label: "OP/USD", symbol: "CRYPTO:OPUSD", base: "OP", quote: "USD", category: "l1" },
  { label: "MATIC/USD", symbol: "CRYPTO:MATICUSD", base: "MATIC", quote: "USD", category: "l1" },
  { label: "DOT/USD", symbol: "CRYPTO:DOTUSD", base: "DOT", quote: "USD", category: "l1" },

  // DeFi
  { label: "LINK/USD", symbol: "CRYPTO:LINKUSD", base: "LINK", quote: "USD", category: "defi" },
  { label: "UNI/USD", symbol: "CRYPTO:UNIUSD", base: "UNI", quote: "USD", category: "defi" },
  { label: "AAVE/USD", symbol: "CRYPTO:AAVEUSD", base: "AAVE", quote: "USD", category: "defi" },
  { label: "MKR/USD", symbol: "CRYPTO:MKRUSD", base: "MKR", quote: "USD", category: "defi" },
  { label: "LDO/USD", symbol: "CRYPTO:LDOUSD", base: "LDO", quote: "USD", category: "defi" },
  { label: "INJ/USD", symbol: "CRYPTO:INJUSD", base: "INJ", quote: "USD", category: "defi" },
  { label: "CRV/USD", symbol: "CRYPTO:CRVUSD", base: "CRV", quote: "USD", category: "defi" },
  { label: "DYDX/USD", symbol: "CRYPTO:DYDXUSD", base: "DYDX", quote: "USD", category: "defi" },

  // Top memes by volume
  { label: "BONK/USD", symbol: "CRYPTO:BONKUSD", base: "BONK", quote: "USD", category: "meme" },
  { label: "WIF/USD", symbol: "CRYPTO:WIFUSD", base: "WIF", quote: "USD", category: "meme" },
  { label: "PEPE/USD", symbol: "CRYPTO:PEPEUSD", base: "PEPE", quote: "USD", category: "meme" },
  { label: "SHIB/USD", symbol: "CRYPTO:SHIBUSD", base: "SHIB", quote: "USD", category: "meme" },
  { label: "FLOKI/USD", symbol: "CRYPTO:FLOKIUSD", base: "FLOKI", quote: "USD", category: "meme" },
  { label: "POPCAT/USD", symbol: "CRYPTO:POPCATUSD", base: "POPCAT", quote: "USD", category: "meme" },
  { label: "MEW/USD", symbol: "CRYPTO:MEWUSD", base: "MEW", quote: "USD", category: "meme" },
  { label: "MYRO/USD", symbol: "CRYPTO:MYROUSD", base: "MYRO", quote: "USD", category: "meme" },
  { label: "BOME/USD", symbol: "CRYPTO:BOMEUSD", base: "BOME", quote: "USD", category: "meme" },
  { label: "MOG/USD", symbol: "CRYPTO:MOGUSD", base: "MOG", quote: "USD", category: "meme" },
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
