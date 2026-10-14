import Link from "next/link";
import { ArrowRight, Zap, Flame, BarChart3 } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function Home() {
  return (
    <div className="flex flex-1 flex-col">
      {/* Hero */}
      <section className="animated-gradient flex flex-1 flex-col items-center justify-center px-4 py-20 text-center">
        <div className="mx-auto max-w-3xl space-y-6">
          <h1 className="text-5xl font-extrabold tracking-tight sm:text-7xl">
            <span className="text-gradient">DEGN</span>{" "}
            <span className="text-foreground">DEX</span>
          </h1>
          <p className="mx-auto max-w-xl text-lg text-muted-foreground sm:text-xl">
            The degenerate&apos;s exchange on Solana. Best-price swaps, fresh
            meme pairs, Raydium pools and live charts in one terminal.
          </p>
          <div className="flex flex-col items-center gap-4 sm:flex-row sm:justify-center">
            <Link href="/swap">
              <Button
                size="lg"
                className="bg-primary text-primary-foreground hover:bg-primary/90 glow-green px-8 py-6 text-lg font-bold"
              >
                Launch App
                <ArrowRight className="ml-2 h-5 w-5" />
              </Button>
            </Link>
            <Link href="/explore">
              <Button
                variant="outline"
                size="lg"
                className="border-border px-8 py-6 text-lg hover:bg-muted"
              >
                Explore Tokens
              </Button>
            </Link>
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="border-t border-border/50 bg-card/30 px-4 py-20">
        <div className="mx-auto grid max-w-5xl gap-8 md:grid-cols-3">
          <div className="space-y-3 rounded-xl border border-border/50 bg-card/50 p-6">
            <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-primary/10">
              <Zap className="h-6 w-6 text-primary" />
            </div>
            <h3 className="text-lg font-semibold">Best-Price Swaps</h3>
            <p className="text-sm text-muted-foreground">
              Swaps run through Jupiter&apos;s meta-aggregator: every router
              competes for your order, including RFQ market makers, and the best
              quote wins.
            </p>
          </div>
          <div className="space-y-3 rounded-xl border border-border/50 bg-card/50 p-6">
            <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-secondary/10">
              <Flame className="h-6 w-6 text-secondary" />
            </div>
            <h3 className="text-lg font-semibold">Meme Discovery</h3>
            <p className="text-sm text-muted-foreground">
              Fresh Pump.fun and trending Solana pairs, refreshed live with
              DexScreener charts and a direct link to swap.
            </p>
          </div>
          <div className="space-y-3 rounded-xl border border-border/50 bg-card/50 p-6">
            <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-neon-pink/10">
              <BarChart3 className="h-6 w-6 text-neon-pink" />
            </div>
            <h3 className="text-lg font-semibold">Pools &amp; Charts</h3>
            <p className="text-sm text-muted-foreground">
              Explore Raydium pools by TVL, volume and APR, and follow markets
              with on-chain price charts in the Trade terminal.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
