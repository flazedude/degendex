"use client";

import { Wallet, ExternalLink, Clock } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";

const RAYDIUM_PORTFOLIO_URL = "https://raydium.io/portfolio/";

export function MyPositions() {
  const { connected } = useWallet();
  const { setVisible } = useWalletModal();

  if (!connected) {
    return (
      <Card className="border-border/50 bg-card/50">
        <CardContent className="flex flex-col items-center justify-center py-16 gap-4">
          <Wallet className="h-10 w-10 text-muted-foreground" />
          <div className="text-center">
            <p className="font-medium">Connect your wallet</p>
            <p className="text-sm text-muted-foreground mt-1">
              View your liquidity positions and earned fees
            </p>
          </div>
          <Button
            onClick={() => setVisible(true)}
            className="bg-primary text-primary-foreground hover:bg-primary/90 glow-green-sm"
          >
            <Wallet className="mr-2 h-4 w-4" />
            Connect Wallet
          </Button>
        </CardContent>
      </Card>
    );
  }

  // Positions are not read from chain yet, so don't claim the wallet has none.
  return (
    <Card className="border-border/50 bg-card/50">
      <CardHeader>
        <CardTitle className="text-base">Your Positions</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col items-center justify-center py-12 gap-3">
          <div className="flex h-12 w-12 items-center justify-center border border-dashed border-border bg-muted/40">
            <Clock className="h-6 w-6 text-muted-foreground" />
          </div>
          <div className="text-center">
            <p className="text-sm font-medium">Position tracking is coming soon</p>
            <p className="text-sm text-muted-foreground mt-1">
              We don&apos;t read your positions yet. Raydium&apos;s portfolio page shows your pools and earned fees.
            </p>
          </div>
          <Button asChild variant="outline" size="sm" className="text-xs gap-1.5">
            <a href={RAYDIUM_PORTFOLIO_URL} target="_blank" rel="noopener noreferrer">
              View on Raydium Portfolio
              <ExternalLink className="h-3 w-3" />
            </a>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
