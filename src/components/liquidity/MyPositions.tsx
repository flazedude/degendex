"use client";

import { Wallet, ExternalLink } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";

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

  // TODO: Fetch actual positions via Raydium SDK / Helius DAS API
  return (
    <Card className="border-border/50 bg-card/50">
      <CardHeader>
        <CardTitle className="text-base">Your Positions</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col items-center justify-center py-12 gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted">
            <Wallet className="h-6 w-6 text-muted-foreground" />
          </div>
          <p className="text-sm text-muted-foreground text-center">
            No liquidity positions found.<br />
            Add liquidity to a pool to start earning fees.
          </p>
          <a
            href="https://raydium.io/liquidity/"
            target="_blank"
            rel="noopener noreferrer"
          >
            <Button variant="outline" size="sm" className="text-xs gap-1.5">
              Manage on Raydium
              <ExternalLink className="h-3 w-3" />
            </Button>
          </a>
        </div>
      </CardContent>
    </Card>
  );
}
