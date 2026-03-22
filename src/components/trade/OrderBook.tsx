"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";

import type { Market } from "@/app/trade/page";

interface OrderBookProps {
  market: Market;
}

// Generate mock order book data
function generateOrders(basePrice: number, side: "ask" | "bid", count: number) {
  const orders: { price: number; size: number; total: number }[] = [];
  for (let i = 0; i < count; i++) {
    const offset = (i + 1) * (basePrice * 0.001 * (0.5 + Math.random()));
    const price = side === "ask" ? basePrice + offset : basePrice - offset;
    const size = Math.random() * 100 + 1;
    const total = orders.length > 0 ? orders[orders.length - 1].total + size : size;
    orders.push({ price, size, total });
  }
  return orders;
}

const BASE_PRICES: Record<string, number> = {
  SOL: 143.46, BTC: 67234.5, ETH: 3456.78, BONK: 0.00002134,
  WIF: 2.34, JUP: 0.82, RAY: 0.62,
};

export function OrderBook({ market }: OrderBookProps) {
  const [tab, setTab] = useState<"book" | "trades">("book");
  const basePrice = BASE_PRICES[market.base] || 100;
  const asks = generateOrders(basePrice, "ask", 12).reverse();
  const bids = generateOrders(basePrice, "bid", 12);
  const maxTotal = Math.max(asks[0]?.total || 0, bids[bids.length - 1]?.total || 0);

  const decimals = basePrice < 1 ? 8 : basePrice < 100 ? 4 : 2;

  return (
    <div className="flex flex-col h-full">
      {/* Tabs */}
      <div className="flex border-b border-border/50 shrink-0">
        <button
          onClick={() => setTab("book")}
          className={cn(
            "flex-1 py-1.5 text-[11px] font-medium transition-colors",
            tab === "book" ? "text-foreground border-b border-primary" : "text-muted-foreground hover:text-foreground"
          )}
        >
          Order Book
        </button>
        <button
          onClick={() => setTab("trades")}
          className={cn(
            "flex-1 py-1.5 text-[11px] font-medium transition-colors",
            tab === "trades" ? "text-foreground border-b border-primary" : "text-muted-foreground hover:text-foreground"
          )}
        >
          Trades
        </button>
      </div>

      {tab === "book" && (
        <div className="flex-1 overflow-hidden flex flex-col">
          {/* Header */}
          <div className="grid grid-cols-3 px-2 py-1 text-[10px] text-muted-foreground shrink-0">
            <span>Price</span>
            <span className="text-right">Size ({market.base})</span>
            <span className="text-right">Total</span>
          </div>

          {/* Asks (sells) */}
          <div className="flex-1 overflow-y-auto flex flex-col justify-end">
            {asks.map((order, i) => (
              <div key={`ask-${i}`} className="relative grid grid-cols-3 px-2 py-px text-[11px] font-mono">
                <div
                  className="absolute inset-y-0 right-0 bg-destructive/10"
                  style={{ width: `${(order.total / maxTotal) * 100}%` }}
                />
                <span className="relative text-destructive">{order.price.toFixed(decimals)}</span>
                <span className="relative text-right text-muted-foreground">{order.size.toFixed(2)}</span>
                <span className="relative text-right text-muted-foreground">{order.total.toFixed(2)}</span>
              </div>
            ))}
          </div>

          {/* Spread / Current price */}
          <div className="px-2 py-1 text-center border-y border-border/30 shrink-0">
            <span className="text-sm font-mono font-bold text-primary">{basePrice.toFixed(decimals)}</span>
            <span className="text-[10px] text-muted-foreground ml-2">Spread 0.01%</span>
          </div>

          {/* Bids (buys) */}
          <div className="flex-1 overflow-y-auto">
            {bids.map((order, i) => (
              <div key={`bid-${i}`} className="relative grid grid-cols-3 px-2 py-px text-[11px] font-mono">
                <div
                  className="absolute inset-y-0 right-0 bg-primary/10"
                  style={{ width: `${(order.total / maxTotal) * 100}%` }}
                />
                <span className="relative text-primary">{order.price.toFixed(decimals)}</span>
                <span className="relative text-right text-muted-foreground">{order.size.toFixed(2)}</span>
                <span className="relative text-right text-muted-foreground">{order.total.toFixed(2)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === "trades" && (
        <div className="flex-1 overflow-y-auto">
          <div className="grid grid-cols-3 px-2 py-1 text-[10px] text-muted-foreground">
            <span>Price</span>
            <span className="text-right">Size</span>
            <span className="text-right">Time</span>
          </div>
          {Array.from({ length: 20 }).map((_, i) => {
            const isBuy = Math.random() > 0.5;
            const price = basePrice + (Math.random() - 0.5) * basePrice * 0.005;
            const size = Math.random() * 50 + 0.1;
            const mins = Math.floor(Math.random() * 60);
            return (
              <div key={i} className="grid grid-cols-3 px-2 py-px text-[11px] font-mono">
                <span className={isBuy ? "text-primary" : "text-destructive"}>{price.toFixed(decimals)}</span>
                <span className="text-right text-muted-foreground">{size.toFixed(2)}</span>
                <span className="text-right text-muted-foreground">{mins}m ago</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
