"use client";

import { cn } from "@/lib/utils";

import type { Market } from "@/app/trade/page";

interface RecentTradesProps {
  market: Market;
}

const BASE_PRICES: Record<string, number> = {
  SOL: 143.46, BTC: 67234.5, ETH: 3456.78, BONK: 0.00002134,
  WIF: 2.34, JUP: 0.82, RAY: 0.62,
};

// Bottom panel with tabs: Balances, Positions, Open Orders, Trade History, Order History
export function RecentTrades({ market }: RecentTradesProps) {
  const basePrice = BASE_PRICES[market.base] || 100;
  const decimals = basePrice < 1 ? 8 : basePrice < 100 ? 4 : 2;

  return (
    <div className="flex flex-col h-full bg-card/30">
      {/* Tabs */}
      <div className="flex gap-4 px-3 border-b border-border/30 shrink-0">
        {["Balances", "Positions", "Open Orders", "Trade History", "Order History"].map((tab, i) => (
          <button
            key={tab}
            className={cn(
              "py-1.5 text-[11px] font-medium transition-colors border-b",
              i === 0
                ? "text-foreground border-primary"
                : "text-muted-foreground border-transparent hover:text-foreground"
            )}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        <table className="w-full text-[11px]">
          <thead>
            <tr className="text-muted-foreground">
              <th className="text-left font-normal px-3 py-1">Asset</th>
              <th className="text-right font-normal px-3 py-1">Balance</th>
              <th className="text-right font-normal px-3 py-1">Value</th>
              <th className="text-right font-normal px-3 py-1">Price</th>
            </tr>
          </thead>
          <tbody className="font-mono">
            <tr className="text-muted-foreground">
              <td colSpan={4} className="text-center py-6 text-xs">
                Connect wallet to view balances
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
