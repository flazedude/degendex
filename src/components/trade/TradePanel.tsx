"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";

import type { Market } from "@/app/trade/page";

interface TradePanelProps {
  market: Market;
}

export function TradePanel({ market }: TradePanelProps) {
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [orderType, setOrderType] = useState<"market" | "limit">("market");
  const [size, setSize] = useState("");
  const [price, setPrice] = useState("");
  const [pctSelected, setPctSelected] = useState<number | null>(null);
  const { connected } = useWallet();
  const { setVisible } = useWalletModal();

  const pctButtons = [25, 50, 75, 100];

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

      {/* Buy/Sell tabs */}
      <div className="grid grid-cols-2 gap-1">
        <button
          onClick={() => setSide("buy")}
          className={cn(
            "py-1.5 text-xs font-bold transition-colors",
            side === "buy"
              ? "bg-primary/20 text-primary border border-primary/50"
              : "bg-muted/30 text-muted-foreground border border-transparent hover:text-foreground"
          )}
        >
          Buy
        </button>
        <button
          onClick={() => setSide("sell")}
          className={cn(
            "py-1.5 text-xs font-bold transition-colors",
            side === "sell"
              ? "bg-destructive/20 text-destructive border border-destructive/50"
              : "bg-muted/30 text-muted-foreground border border-transparent hover:text-foreground"
          )}
        >
          Sell
        </button>
      </div>

      {/* Price input (limit only) */}
      {orderType === "limit" && (
        <div>
          <label className="text-[10px] text-muted-foreground">Price</label>
          <Input
            type="number"
            placeholder="0.00"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            className="h-8 text-sm font-mono bg-background border-border"
          />
        </div>
      )}

      {/* Size input */}
      <div>
        <div className="flex items-center justify-between">
          <label className="text-[10px] text-muted-foreground">Size</label>
          <span className="text-[10px] text-muted-foreground">{market.base}</span>
        </div>
        <Input
          type="number"
          placeholder="0.00"
          value={size}
          onChange={(e) => { setSize(e.target.value); setPctSelected(null); }}
          className="h-8 text-sm font-mono bg-background border-border"
        />
      </div>

      {/* Percentage buttons */}
      <div className="flex gap-1">
        {pctButtons.map((pct) => (
          <button
            key={pct}
            onClick={() => setPctSelected(pct)}
            className={cn(
              "flex-1 py-1 text-[10px] font-medium border transition-colors",
              pctSelected === pct
                ? "border-primary/50 bg-primary/10 text-primary"
                : "border-border/50 text-muted-foreground hover:text-foreground"
            )}
          >
            {pct}%
          </button>
        ))}
      </div>

      {/* Available to trade */}
      <div className="flex justify-between text-[10px] text-muted-foreground">
        <span>Available to Trade</span>
        <span className="font-mono">0.00 {market.quote}</span>
      </div>

      {/* Submit button */}
      {connected ? (
        <Button
          className={cn(
            "w-full h-9 text-xs font-bold",
            side === "buy"
              ? "bg-primary text-primary-foreground hover:bg-primary/90 glow-green-sm"
              : "bg-destructive text-destructive-foreground hover:bg-destructive/90"
          )}
          disabled={!size}
        >
          {side === "buy" ? `Buy ${market.base}` : `Sell ${market.base}`}
        </Button>
      ) : (
        <Button
          onClick={() => setVisible(true)}
          className="w-full h-9 text-xs font-bold bg-secondary text-secondary-foreground hover:bg-secondary/90 glow-purple"
        >
          Connect
        </Button>
      )}
    </div>
  );
}
