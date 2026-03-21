export function Footer() {
  return (
    <footer className="border-t border-border/50 bg-background/50">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-4">
        <p className="text-sm text-muted-foreground">
          <span className="text-gradient font-semibold">DEGN DEX</span>{" "}
          &mdash; Ape responsibly.
        </p>
        <div className="flex items-center gap-4">
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span className="h-2 w-2 rounded-full bg-neon-green pulse-glow" />
            Solana Mainnet
          </span>
        </div>
      </div>
    </footer>
  );
}
