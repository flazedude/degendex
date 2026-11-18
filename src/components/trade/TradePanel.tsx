"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { USDC_MINT } from "@/lib/constants";

import type { Market } from "@/app/trade/page";

interface TradePanelProps {
  market: Market;
}

// The terminal has no order engine of its own. Market orders hand off to the
// Swap page (Jupiter routing); limit orders are not available yet.
export function TradePanel({ market }: TradePanelProps) {
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [orderType, setOrderType] = useState<"market" | "limit">("market");

  const tradable = orderType === "market" && !!market.mint;
  const pay = side === "buy" ? "USDC" : market.base;
  const receive = side === "buy" ? market.base : "USDC";
  const swapHref = market.mint
    ? side === "buy"
      ? `/swap?inputMint=${USDC_MINT}&outputMint=${market.mint}`
      : `/swap?inputMint=${market.mint}&outputMint=${USDC_MINT}`
    : null;

  return (
    <div className="p-3 space-y-2">
      {/* Order type tabs */}
      <div className="flex gap-1 text-[11px]">
        {(["market", "limit"] as const).map((type) => (
          <button
            key={type}
            onClick={() => setOrderType(type)}
            className={cn(
              "px-2 py-1 font-medium capitalize transition-colors",
              orderType === type
                ? "text-foreground border-b border-primary"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            {type}
          </button>
        ))}
      </div>

      {/* Buy/Sell tabs (only meaningful when the market can be swapped) */}
      <div className="grid grid-cols-2 gap-1">
        <button
          onClick={() => setSide("buy")}
          disabled={!tradable}
          className={cn(
            "py-1.5 text-xs font-bold transition-colors disabled:cursor-not-allowed disabled:opacity-40",
            side === "buy"
              ? "bg-primary/20 text-primary border border-primary/50"
              : "bg-muted/30 text-muted-foreground border border-transparent enabled:hover:text-foreground"
          )}
        >
          Buy
        </button>
        <button
          onClick={() => setSide("sell")}
          disabled={!tradable}
          className={cn(
            "py-1.5 text-xs font-bold transition-colors disabled:cursor-not-allowed disabled:opacity-40",
            side === "sell"
              ? "bg-destructive/20 text-destructive border border-destructive/50"
              : "bg-muted/30 text-muted-foreground border border-transparent enabled:hover:text-foreground"
          )}
        >
          Sell
        </button>
      </div>

      {orderType === "limit" ? (
        <>
          <Button disabled className="w-full h-9 text-xs font-bold bg-muted text-muted-foreground">
            Limit orders coming soon
          </Button>
          <p className="text-[10px] leading-snug text-muted-foreground">
            {market.mint
              ? "Use the Market tab to swap via Jupiter on the Swap page."
              : `${market.base} has no verified Solana token here, so this market is chart only.`}
          </p>
        </>
      ) : swapHref ? (
        <>
          {/* Route preview: what the Swap page will be prefilled with */}
          <div className="border border-border/50 bg-background/50 px-2 py-1.5 text-[10px] font-mono space-y-0.5">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Pay</span>
              <span>{pay}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Receive</span>
              <span>{receive}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Route</span>
              <span>Jupiter, quoted on Swap</span>
            </div>
          </div>
          <Button
            asChild
            className={cn(
              "w-full h-9 text-xs font-bold",
              side === "buy"
                ? "bg-primary text-primary-foreground hover:bg-primary/90 glow-green-sm"
                : "bg-destructive text-destructive-foreground hover:bg-destructive/90"
            )}
          >
            <Link href={swapHref}>
              {side === "buy" ? `Buy ${market.base} on Swap` : `Sell ${market.base} on Swap`}
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </Button>
          <p className="text-[10px] leading-snug text-muted-foreground">
            Opens Swap with this pair filled in. Amount and slippage are set there.
          </p>
        </>
      ) : (
        <>
          <Button disabled className="w-full h-9 text-xs font-bold bg-muted text-muted-foreground">
            Not tradable on Solana
          </Button>
          <p className="text-[10px] leading-snug text-muted-foreground">
            {market.base} has no verified Solana token here, so this market is chart only.
          </p>
        </>
      )}
    </div>
  );
}
