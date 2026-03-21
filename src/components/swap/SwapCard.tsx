"use client";

import { ArrowDownUp, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useSwapStore } from "@/store/useSwapStore";
import { useSwap } from "@/hooks/useSwap";
import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { TokenSelector } from "./TokenSelector";
import { SwapSettings } from "./SwapSettings";
import { cn } from "@/lib/utils";

export function SwapCard() {
  const {
    inputToken,
    outputToken,
    inputAmount,
    outputAmount,
    setInputToken,
    setOutputToken,
    setInputAmount,
    switchTokens,
  } = useSwapStore();
  const { quote, executeSwap, loading, priceImpact } = useSwap();
  const { connected } = useWallet();
  const { setVisible } = useWalletModal();

  const handleSwapClick = () => {
    if (!connected) {
      setVisible(true);
      return;
    }
    executeSwap();
  };

  const rate =
    inputAmount && outputAmount && parseFloat(inputAmount) > 0
      ? (parseFloat(outputAmount) / parseFloat(inputAmount)).toFixed(6)
      : null;

  return (
    <Card className="w-full max-w-md border-border/50 bg-card/80 backdrop-blur-sm border-gradient">
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-lg font-semibold">Swap</CardTitle>
        <SwapSettings />
      </CardHeader>

      <CardContent className="space-y-3">
        {/* Input Token */}
        <div className="bg-background/50 p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs text-muted-foreground">You pay</span>
          </div>
          <div className="flex items-center gap-3">
            <Input
              type="number"
              placeholder="0.00"
              value={inputAmount}
              onChange={(e) => setInputAmount(e.target.value)}
              className="border-0 bg-transparent p-0 text-2xl font-semibold focus-visible:ring-0 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
            />
            <TokenSelector
              selectedToken={inputToken}
              onSelect={setInputToken}
            >
              <Button
                variant="outline"
                className="shrink-0 gap-2 border-border bg-muted/50 font-semibold hover:bg-muted"
              >
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-muted-foreground/20 text-xs font-bold">
                  {inputToken.symbol[0]}
                </span>
                {inputToken.symbol}
              </Button>
            </TokenSelector>
          </div>
        </div>

        {/* Switch button */}
        <div className="flex justify-center -my-1">
          <Button
            variant="ghost"
            size="icon"
            onClick={switchTokens}
            className="h-8 w-8 rounded-full border border-border bg-card hover:bg-muted hover:border-primary/50 transition-all"
          >
            <ArrowDownUp className="h-4 w-4" />
          </Button>
        </div>

        {/* Output Token */}
        <div className="bg-background/50 p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs text-muted-foreground">You receive</span>
          </div>
          <div className="flex items-center gap-3">
            <Input
              type="number"
              placeholder="0.00"
              value={outputAmount}
              readOnly
              className="border-0 bg-transparent p-0 text-2xl font-semibold focus-visible:ring-0 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
            />
            <TokenSelector
              selectedToken={outputToken}
              onSelect={setOutputToken}
            >
              <Button
                variant="outline"
                className="shrink-0 gap-2 border-border bg-muted/50 font-semibold hover:bg-muted"
              >
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-muted-foreground/20 text-xs font-bold">
                  {outputToken.symbol[0]}
                </span>
                {outputToken.symbol}
              </Button>
            </TokenSelector>
          </div>
        </div>

        {/* Rate & Price Impact */}
        {rate && (
          <div className="space-y-1 bg-background/30 px-3 py-2 text-xs text-muted-foreground">
            <div className="flex justify-between">
              <span>Rate</span>
              <span>
                1 {inputToken.symbol} = {rate} {outputToken.symbol}
              </span>
            </div>
            {priceImpact !== null && (
              <div className="flex justify-between">
                <span>Price Impact</span>
                <span
                  className={cn(
                    priceImpact > 3
                      ? "text-destructive"
                      : priceImpact > 1
                      ? "text-yellow-500"
                      : "text-primary"
                  )}
                >
                  {priceImpact.toFixed(4)}%
                </span>
              </div>
            )}
            {quote && (
              <div className="flex justify-between">
                <span>Route</span>
                <span>
                  {quote.routePlan
                    .map((r) => r.swapInfo.label)
                    .join(" -> ")}
                </span>
              </div>
            )}
          </div>
        )}

        {/* Swap Button */}
        <Button
          onClick={handleSwapClick}
          disabled={loading || (!connected ? false : !quote)}
          className={cn(
            "w-full py-6 text-base font-bold",
            connected
              ? "bg-primary text-primary-foreground hover:bg-primary/90 glow-green"
              : "bg-secondary text-secondary-foreground hover:bg-secondary/90 glow-purple"
          )}
        >
          {loading ? (
            <>
              <Loader2 className="mr-2 h-5 w-5 animate-spin" />
              {quote ? "Swapping..." : "Fetching quote..."}
            </>
          ) : !connected ? (
            "Connect Wallet"
          ) : !inputAmount ? (
            "Enter an amount"
          ) : !quote ? (
            "No route found"
          ) : (
            "Swap"
          )}
        </Button>
      </CardContent>
    </Card>
  );
}
