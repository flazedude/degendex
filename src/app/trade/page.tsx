import type { Metadata } from "next";
import { Suspense } from "react";
import { TradeTerminal } from "./TradeTerminal";

export const metadata: Metadata = {
  title: "Trade | DEGN DEX",
  description:
    "Solana trade terminal: on-chain charts, recent trades and market orders routed through Jupiter.",
};

function TerminalFallback() {
  return (
    <div className="flex h-[calc(100dvh-2.5rem)] items-center justify-center text-[11px] text-muted-foreground">
      Loading terminal…
    </div>
  );
}

export default function TradePage() {
  return (
    <Suspense fallback={<TerminalFallback />}>
      <TradeTerminal />
    </Suspense>
  );
}
