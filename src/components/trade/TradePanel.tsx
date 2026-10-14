"use client";

import { useEffect } from "react";
import { useSettingsStore } from "@/store/useSettingsStore";
import type { TokenInfo } from "@/lib/tokens/types";
import { cn } from "@/lib/utils";
import { MarketOrderForm } from "./MarketOrderForm";

const TABS = [
  { id: "market", label: "Market", enabled: true },
  { id: "limit", label: "Limit", enabled: false },
  { id: "dca", label: "DCA", enabled: false },
] as const;

const COMING_NEXT = "Limit orders and DCA are coming next";

/**
 * Order entry for the terminal. Market orders swap via Jupiter on the same
 * engine as the Swap page; USDC is the quote (SOL when the base is USDC).
 */
export function TradePanel({ base }: { base: TokenInfo }) {
  // Slippage is a persisted setting shared with the Swap page.
  useEffect(() => {
    void useSettingsStore.persist.rehydrate();
  }, []);

  return (
    <div className="space-y-2 p-3">
      <div>
        <div role="tablist" aria-label="Order type" className="flex gap-1 border-b border-border/50 text-[11px]">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={t.id === "market"}
              disabled={!t.enabled}
              title={t.enabled ? undefined : COMING_NEXT}
              className={cn(
                "-mb-px border-b px-2 py-1 font-medium transition-colors",
                t.id === "market"
                  ? "border-primary text-foreground"
                  : "border-transparent text-muted-foreground disabled:cursor-not-allowed disabled:opacity-40"
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
        <p className="pt-1 text-[10px] text-muted-foreground">{COMING_NEXT}</p>
      </div>
      <MarketOrderForm base={base} />
    </div>
  );
}
