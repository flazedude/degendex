import { TokenTable } from "@/components/explore/TokenTable";

export default function ExplorePage() {
  return (
    <div className="mx-auto w-full max-w-6xl px-4 pt-4 pb-16">
      <div className="mb-3">
        <h1 className="text-xl font-bold">
          <span className="text-gradient">Explore</span> Tokens
        </h1>
        <p className="text-xs text-muted-foreground">
          Top Solana pairs from DexScreener. Sort by 24h volume, liquidity, or
          24h price change.
        </p>
      </div>
      <TokenTable />
    </div>
  );
}
