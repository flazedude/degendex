"use client";

import { useEffect, useState } from "react";
import { useSettingsStore } from "@/store/useSettingsStore";
import { TRIGGER_ENABLED } from "@/lib/jupiter/trigger/config";
import type { TokenInfo } from "@/lib/tokens/types";
import { cn } from "@/lib/utils";
import { MarketOrderForm } from "./MarketOrderForm";
import { DcaForm, LimitOrderForm, isStableToken } from "./trigger";

const TABS = [
  { id: "market", label: "Market", trigger: false },
  { id: "limit", label: "Limit", trigger: true },
  { id: "dca", label: "DCA", trigger: true },
] as const;
type TabId = (typeof TABS)[number]["id"];

const UNAVAILABLE = "Temporarily unavailable";

/**
 * Order entry for the terminal. Market orders swap via Jupiter on the same
 * engine as the Swap page; USDC is the quote (SOL when the base is USDC).
 * Limit and DCA orders run on Jupiter Trigger v2 against USDC.
 */
export function TradePanel({ base }: { base: TokenInfo }) {
  const [tab, setTab] = useState<TabId>("market");
  // Slippage is a persisted setting shared with the Swap page.
  useEffect(() => {
    void useSettingsStore.persist.rehydrate();
  }, []);

  const active: TabId = !TRIGGER_ENABLED && tab !== "market" ? "market" : tab;
  const stableBase = isStableToken(base);

  return (
    <div className="space-y-2 p-3">
      <div>
        <div role="tablist" aria-label="Order type" className="flex gap-1 border-b border-border/50 text-[11px]">
          {TABS.map((t) => {
            const enabled = !t.trigger || TRIGGER_ENABLED;
            return (
              <button
                key={t.id}
                type="button"
                role="tab"
                id={`order-tab-${t.id}`}
                aria-selected={active === t.id}
                aria-controls="order-tabpanel"
                disabled={!enabled}
                title={enabled ? undefined : UNAVAILABLE}
                onClick={() => setTab(t.id)}
                className={cn(
                  "-mb-px border-b px-2 py-1 font-medium transition-colors",
                  active === t.id
                    ? "border-primary text-foreground"
                    : "border-transparent text-muted-foreground enabled:hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
                )}
              >
                {t.label}
              </button>
            );
          })}
        </div>
        {!TRIGGER_ENABLED && (
          <p className="pt-1 text-[10px] text-muted-foreground">Limit orders and DCA are {UNAVAILABLE.toLowerCase()}</p>
        )}
      </div>
      <div id="order-tabpanel" role="tabpanel" aria-labelledby={`order-tab-${active}`}>
        {active === "market" ? (
          <MarketOrderForm base={base} />
        ) : stableBase ? (
          <p className="border border-border/50 bg-background/30 px-2 py-3 text-center text-[11px] text-muted-foreground">
            Pick a non-stable token for limit orders and DCA
          </p>
        ) : active === "limit" ? (
          <LimitOrderForm base={base} />
        ) : (
          <DcaForm base={base} />
        )}
      </div>
    </div>
  );
}
