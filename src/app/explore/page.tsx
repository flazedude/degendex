import { TokenTable } from "@/components/explore/TokenTable";

export default function ExplorePage() {
  return (
    <div className="mx-auto w-full max-w-6xl px-4 pt-8 pb-20">
      <div className="mb-6">
        <h1 className="text-2xl font-bold">
          <span className="text-gradient">Explore</span> Tokens
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Discover trending tokens on Solana. Sorted by volume, market cap, or
          price change.
        </p>
      </div>
      <TokenTable />
    </div>
  );
}
