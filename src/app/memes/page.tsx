import { MemeGrid } from "@/components/memes/MemeGrid";

export default function MemesPage() {
  return (
    <div className="mx-auto w-full max-w-7xl px-4 pt-8 pb-20">
      <div className="mb-6">
        <h1 className="text-2xl font-bold">
          <span className="text-gradient">Memes</span>{" "}
          <span className="text-foreground">Live</span>
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Fresh memecoins from Pump.fun &mdash; live polling every 15 seconds with
          DexScreener charts.
        </p>
      </div>
      <MemeGrid />
    </div>
  );
}
