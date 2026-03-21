import { TokenTable } from "@/components/explore/TokenTable";

export default function ExplorePage() {
  return (
    <div className="mx-auto w-full max-w-6xl px-4 pt-4 pb-16">
      <div className="mb-3">
        <h1 className="text-xl font-bold">
          <span className="text-gradient">Explore</span> Tokens
        </h1>
        <p className="text-xs text-muted-foreground">
          Discover trending tokens on Solana. Sorted by volume, market cap, or
          price change.
        </p>
      </div>
      <TokenTable />
    </div>
  );
}
