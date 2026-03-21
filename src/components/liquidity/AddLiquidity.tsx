"use client";

import { useState } from "react";
import { ArrowLeft, Loader2, AlertTriangle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { formatNumber } from "@/lib/utils";
import { cn } from "@/lib/utils";
import type { RaydiumPool } from "@/lib/api/raydium";
import { toast } from "sonner";

interface AddLiquidityProps {
  pool: RaydiumPool;
  onBack: () => void;
}

export function AddLiquidity({ pool, onBack }: AddLiquidityProps) {
  const { connected } = useWallet();
  const { setVisible } = useWalletModal();
  const [amountA, setAmountA] = useState("");
  const [amountB, setAmountB] = useState("");
  const [loading, setLoading] = useState(false);

  // Calculate paired amount based on pool ratio
  const handleAmountAChange = (value: string) => {
    setAmountA(value);
    if (value && parseFloat(value) > 0 && pool.price > 0) {
      setAmountB((parseFloat(value) * pool.price).toFixed(6));
    } else {
      setAmountB("");
    }
  };

  const handleAmountBChange = (value: string) => {
    setAmountB(value);
    if (value && parseFloat(value) > 0 && pool.price > 0) {
      setAmountA((parseFloat(value) / pool.price).toFixed(6));
    } else {
      setAmountA("");
    }
  };

  const handleAddLiquidity = async () => {
    if (!connected) {
      setVisible(true);
      return;
    }

    try {
      setLoading(true);
      toast.loading("Adding liquidity...", { id: "add-liq" });

      // TODO: Integrate Raydium SDK V2 for actual deposit transaction
      // For now, show what the integration will do
      await new Promise((r) => setTimeout(r, 2000));

      toast.success(
        `Added ${amountA} ${pool.mintA.symbol} + ${amountB} ${pool.mintB.symbol}`,
        { id: "add-liq" }
      );
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Failed to add liquidity";
      toast.error(message, { id: "add-liq" });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card className="w-full max-w-lg border-border/50 bg-card/80 border-gradient">
      <CardHeader className="pb-3">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={onBack} className="h-8 w-8">
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <CardTitle className="text-lg">Add Liquidity</CardTitle>
        </div>
        <div className="flex items-center gap-2 mt-2">
          <div className="flex -space-x-1.5">
            {pool.mintA.logoURI ? (
              <img src={pool.mintA.logoURI} alt={pool.mintA.symbol} className="h-6 w-6 rounded-full border-2 border-card" />
            ) : (
              <div className="flex h-6 w-6 items-center justify-center rounded-full bg-muted text-[10px] font-bold border-2 border-card">{pool.mintA.symbol?.[0]}</div>
            )}
            {pool.mintB.logoURI ? (
              <img src={pool.mintB.logoURI} alt={pool.mintB.symbol} className="h-6 w-6 rounded-full border-2 border-card" />
            ) : (
              <div className="flex h-6 w-6 items-center justify-center rounded-full bg-muted text-[10px] font-bold border-2 border-card">{pool.mintB.symbol?.[0]}</div>
            )}
          </div>
          <span className="font-medium text-sm">{pool.mintA.symbol}/{pool.mintB.symbol}</span>
          <Badge variant="outline" className={cn(
            "text-[10px] px-1.5 py-0",
            pool.type === "Concentrated" ? "border-neon-purple/50 text-neon-purple" : "border-primary/50 text-primary"
          )}>
            {pool.type === "Concentrated" ? "CLMM" : "CPMM"}
          </Badge>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Pool Stats */}
        <div className="grid grid-cols-3 gap-3 bg-background/50 p-2.5">
          <div className="text-center">
            <p className="text-[10px] text-muted-foreground">TVL</p>
            <p className="text-sm font-medium">${formatNumber(pool.tvl)}</p>
          </div>
          <div className="text-center">
            <p className="text-[10px] text-muted-foreground">APR (24h)</p>
            <p className={cn("text-sm font-medium", pool.day.apr > 100 ? "text-primary" : "text-foreground")}>
              {pool.day.apr.toFixed(1)}%
            </p>
          </div>
          <div className="text-center">
            <p className="text-[10px] text-muted-foreground">Fee Rate</p>
            <p className="text-sm font-medium">{(pool.feeRate * 100).toFixed(2)}%</p>
          </div>
        </div>

        {/* Token A Input */}
        <div className="bg-background/50 p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs text-muted-foreground">{pool.mintA.symbol}</span>
          </div>
          <div className="flex items-center gap-3">
            <Input
              type="number"
              placeholder="0.00"
              value={amountA}
              onChange={(e) => handleAmountAChange(e.target.value)}
              className="border-0 bg-transparent p-0 text-xl font-semibold focus-visible:ring-0 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
            />
            <div className="flex items-center gap-1.5 shrink-0 rounded-full bg-muted/50 px-3 py-1.5">
              {pool.mintA.logoURI ? (
                <img src={pool.mintA.logoURI} alt={pool.mintA.symbol} className="h-5 w-5 rounded-full" />
              ) : (
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-muted-foreground/20 text-[10px] font-bold">{pool.mintA.symbol?.[0]}</span>
              )}
              <span className="font-semibold text-sm">{pool.mintA.symbol}</span>
            </div>
          </div>
        </div>

        {/* Token B Input */}
        <div className="bg-background/50 p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs text-muted-foreground">{pool.mintB.symbol}</span>
          </div>
          <div className="flex items-center gap-3">
            <Input
              type="number"
              placeholder="0.00"
              value={amountB}
              onChange={(e) => handleAmountBChange(e.target.value)}
              className="border-0 bg-transparent p-0 text-xl font-semibold focus-visible:ring-0 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
            />
            <div className="flex items-center gap-1.5 shrink-0 rounded-full bg-muted/50 px-3 py-1.5">
              {pool.mintB.logoURI ? (
                <img src={pool.mintB.logoURI} alt={pool.mintB.symbol} className="h-5 w-5 rounded-full" />
              ) : (
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-muted-foreground/20 text-[10px] font-bold">{pool.mintB.symbol?.[0]}</span>
              )}
              <span className="font-semibold text-sm">{pool.mintB.symbol}</span>
            </div>
          </div>
        </div>

        {/* Price info */}
        <div className="bg-background/30 px-3 py-2 text-xs text-muted-foreground space-y-1">
          <div className="flex justify-between">
            <span>Pool Price</span>
            <span>1 {pool.mintA.symbol} = {pool.price.toFixed(6)} {pool.mintB.symbol}</span>
          </div>
          <div className="flex justify-between">
            <span>Your Share</span>
            <span>~0.00%</span>
          </div>
        </div>

        {/* Warning for concentrated */}
        {pool.type === "Concentrated" && (
          <div className="flex items-start gap-2 border border-yellow-500/30 bg-yellow-500/5 px-3 py-2">
            <AlertTriangle className="h-4 w-4 text-yellow-500 shrink-0 mt-0.5" />
            <p className="text-xs text-yellow-500/80">
              Concentrated liquidity requires setting a price range. Full SDK integration coming soon.
            </p>
          </div>
        )}

        <Separator className="bg-border/50" />

        {/* Add Button */}
        <Button
          onClick={handleAddLiquidity}
          disabled={loading || !amountA || !amountB}
          className={cn(
            "w-full py-6 text-base font-bold",
            connected
              ? "bg-primary text-primary-foreground hover:bg-primary/90 glow-green"
              : "bg-secondary text-secondary-foreground hover:bg-secondary/90 glow-purple"
          )}
        >
          {loading ? (
            <><Loader2 className="mr-2 h-5 w-5 animate-spin" />Adding Liquidity...</>
          ) : !connected ? (
            "Connect Wallet"
          ) : !amountA || !amountB ? (
            "Enter amounts"
          ) : (
            "Add Liquidity"
          )}
        </Button>
      </CardContent>
    </Card>
  );
}
