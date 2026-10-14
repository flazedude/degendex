"use client";

import { useEffect, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { ArrowUpRight } from "lucide-react";
import { useSettingsStore } from "@/store/useSettingsStore";
import { useSwapInFlight } from "@/store/usePendingSwapStore";
import { JUPITER_APP_URL, TRIGGER_MODE, TRIGGER_OFF_MESSAGE } from "@/lib/jupiter/trigger/config";
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

const TRIGGER_OFF_TITLE = "Turned off here";
const SWAP_RUNNING = "Wait for the market order to finish";

/**
 * Order entry for the terminal. Market orders swap via Jupiter on the same
 * engine as the Swap page; USDC is the quote (SOL when the base is USDC).
 * Limit and DCA orders run on Jupiter Trigger v2 against USDC.
 */
export function TradePanel({ base }: { base: TokenInfo }) {
  const [tab, setTab] = useState<TabId>("market");
  const { publicKey } = useWallet();
  // Leaving the Market tab mid-swap would hide the running order's progress.
  const swapRunning = !!useSwapInFlight(publicKey?.toBase58());
  // Slippage is a persisted setting shared with the Swap page.
  useEffect(() => {
    void useSettingsStore.persist.rehydrate();
  }, []);

  // Fully off ("off"): Limit / DCA are locked and the note points to jup.ag,
  // which manages the same vault. With only new orders paused
  // ("new-orders-off") the tabs stay open and the forms show their own note.
  const triggerOff = TRIGGER_MODE === "off";
  const active: TabId = triggerOff && tab !== "market" ? "market" : tab;
  const stableBase = isStableToken(base);

  return (
    <div className="space-y-2 p-3">
      <div>
        <div role="tablist" aria-label="Order type" className="flex gap-1 border-b border-border/50 text-[11px]">
          {TABS.map((t) => {
            const available = !t.trigger || !triggerOff;
            const locked = swapRunning && t.trigger && t.id !== active;
            const enabled = available && !locked;
            return (
              <button
                key={t.id}
                type="button"
                role="tab"
                id={`order-tab-${t.id}`}
                aria-selected={active === t.id}
                aria-controls="order-tabpanel"
                disabled={!enabled}
                title={!available ? TRIGGER_OFF_TITLE : locked ? SWAP_RUNNING : undefined}
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
        {triggerOff && (
          <p className="pt-1 text-[10px] text-muted-foreground">
            Limit orders and DCA are turned off here. {TRIGGER_OFF_MESSAGE}{" "}
            <a
              href={JUPITER_APP_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-0.5 text-primary hover:underline"
            >
              Open jup.ag <ArrowUpRight className="h-2.5 w-2.5" />
            </a>
          </p>
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
