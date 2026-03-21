import { MemeGrid } from "@/components/memes/MemeGrid";

export default function MemesPage() {
  return (
    <div className="mx-auto w-full max-w-7xl px-4 pt-4 pb-16">
      <div className="mb-3">
        <h1 className="text-xl font-bold">
          <span className="text-gradient">Memes</span>{" "}
          <span className="text-foreground">Live</span>
        </h1>
        <p className="text-xs text-muted-foreground">
          Fresh memecoins from Pump.fun &mdash; live polling every 15 seconds with
          DexScreener charts.
        </p>
      </div>
      <MemeGrid />
    </div>
  );
}
