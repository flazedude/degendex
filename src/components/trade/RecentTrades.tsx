"use client";

import { useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { cn } from "@/lib/utils";

const TABS = ["Balances", "Positions", "Open Orders", "Trade History", "Order History"] as const;
type Tab = (typeof TABS)[number];

// Account data is not wired up yet: every tab says so instead of showing zeros.
const COMING_SOON: Record<Exclude<Tab, "Balances">, string> = {
  Positions: "Positions coming soon",
  "Open Orders": "Open orders coming soon",
  "Trade History": "Trade history coming soon",
  "Order History": "Order history coming soon",
};

// Bottom panel with account tabs
export function RecentTrades() {
  const [tab, setTab] = useState<Tab>("Balances");
  const { connected } = useWallet();

  const message =
    tab === "Balances"
      ? connected
        ? "Balances coming soon"
        : "Connect wallet to view balances"
      : COMING_SOON[tab];

  return (
    <div className="flex flex-col h-full bg-card/30">
      {/* Tabs */}
      <div className="flex gap-4 px-3 border-b border-border/30 shrink-0 overflow-x-auto">
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={cn(
              "py-1.5 text-[11px] font-medium transition-colors border-b whitespace-nowrap",
              tab === t
                ? "text-foreground border-primary"
                : "text-muted-foreground border-transparent hover:text-foreground"
            )}
          >
            {t}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex flex-1 items-center justify-center px-3">
        <p className="text-xs text-muted-foreground">{message}</p>
      </div>
    </div>
  );
}
