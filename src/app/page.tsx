import Link from "next/link";
import { ArrowRight, Zap, Shield, BarChart3 } from "lucide-react";
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
            The degenerate&apos;s decentralized exchange on Solana. Swap, provide
            liquidity, and trade with the speed of light.
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
            <h3 className="text-lg font-semibold">Lightning Fast</h3>
            <p className="text-sm text-muted-foreground">
              Powered by Solana. Sub-second finality. Fees measured in fractions
              of a cent.
            </p>
          </div>
          <div className="space-y-3 rounded-xl border border-border/50 bg-card/50 p-6">
            <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-secondary/10">
              <Shield className="h-6 w-6 text-secondary" />
            </div>
            <h3 className="text-lg font-semibold">Best Prices</h3>
            <p className="text-sm text-muted-foreground">
              Jupiter aggregation finds the best route across all Solana DEXes.
              No middleman.
            </p>
          </div>
          <div className="space-y-3 rounded-xl border border-border/50 bg-card/50 p-6">
            <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-neon-pink/10">
              <BarChart3 className="h-6 w-6 text-neon-pink" />
            </div>
            <h3 className="text-lg font-semibold">Full Featured</h3>
            <p className="text-sm text-muted-foreground">
              Swaps, liquidity pools, limit orders, charts, and portfolio
              tracking. All in one place.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
