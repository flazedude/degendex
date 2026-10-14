"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import { useSearchParams } from "next/navigation";
import { List, Loader2 } from "lucide-react";
import { useMarketDetail } from "@/hooks/useMarketDetail";
import { useMarkets } from "@/hooks/useMarkets";
import { MarketFetchError } from "@/lib/markets/client";
import type { TokenInfo } from "@/lib/tokens/types";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { MarketBar } from "@/components/trade/MarketBar";
import { MarketSelector } from "@/components/trade/MarketSelector";
import { TradePanel } from "@/components/trade/TradePanel";
import { TradesPanel } from "@/components/trade/TradesPanel";
import { BottomPanel } from "@/components/trade/BottomPanel";
import { baseTokenKey, resolveBaseToken, selectedMintFromParam } from "./baseToken";

// lightweight-charts touches the DOM on import: client only.
const PriceChart = dynamic(() => import("@/components/trade/PriceChart").then((m) => m.PriceChart), {
  ssr: false,
  loading: () => (
    <div className="flex h-full items-center justify-center gap-1.5 text-[11px] text-muted-foreground">
      <Loader2 className="h-3 w-3 animate-spin" /> Loading chart…
    </div>
  ),
});

/** Resolves the base token once and keeps its identity while nothing relevant changes. */
function useBaseToken(mint: string): { base: TokenInfo | null; notFound: boolean; failed: boolean } {
  const markets = useMarkets();
  const detail = useMarketDetail(mint);
  const summary = markets.data?.markets.find((m) => m.mint === mint);
  const resolved = resolveBaseToken(mint, detail.data, summary);
  // Keep the previous object while its content is unchanged (React's "adjust
  // state when inputs change" pattern), so polls don't churn the order form.
  const key = baseTokenKey(resolved);
  const [kept, setKept] = useState({ key, token: resolved });
  if (kept.key !== key) setKept({ key, token: resolved });
  const base = kept.key === key ? kept.token : resolved;
  const notFound =
    !base && detail.error instanceof MarketFetchError && detail.error.status === 404;
  return { base, notFound, failed: !base && detail.isError && !notFound };
}

function TradePanelSlot({ base, notFound, failed }: { base: TokenInfo | null; notFound: boolean; failed: boolean }) {
  if (base) return <TradePanel base={base} />;
  return (
    <div className="flex min-h-40 items-center justify-center p-3 text-center text-[11px] text-muted-foreground">
      {notFound ? (
        "Jupiter doesn't list this token, so it can't be traded here."
      ) : failed ? (
        "Couldn't load this token's details (decimals are needed before trading). Retrying…"
      ) : (
        <span className="flex items-center gap-1.5">
          <Loader2 className="h-3 w-3 animate-spin" /> Loading token…
        </span>
      )}
    </div>
  );
}

export function TradeTerminal() {
  const searchParams = useSearchParams();
  const mint = selectedMintFromParam(searchParams.get("mint"));
  const { base, notFound, failed } = useBaseToken(mint);
  const [sheetOpen, setSheetOpen] = useState(false);

  return (
    <div className="flex flex-col lg:h-[calc(100dvh-2.5rem)] lg:overflow-hidden">
      {/* Market bar (with the market list as a sheet below lg) */}
      <div className="flex min-w-0 shrink-0">
        <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
          <SheetTrigger asChild>
            <button
              type="button"
              className="flex h-12 shrink-0 items-center gap-1 border-b border-r border-border/50 bg-card/50 px-2.5 text-[11px] text-muted-foreground hover:text-foreground lg:hidden"
              aria-label="Open market list"
            >
              <List className="h-3.5 w-3.5" /> Markets
            </button>
          </SheetTrigger>
          <SheetContent side="left" className="w-72 gap-0 bg-card p-0" aria-describedby={undefined}>
            <SheetTitle className="border-b border-border/50 px-3 py-2.5 text-xs">Solana markets</SheetTitle>
            <div className="min-h-0 flex-1">
              <MarketSelector selectedMint={mint} onSelect={() => setSheetOpen(false)} />
            </div>
          </SheetContent>
        </Sheet>
        <div className="min-w-0 flex-1">
          <MarketBar mint={mint} fallback={base ?? undefined} />
        </div>
      </div>

      {/*
        One instance of each panel. Below lg the two column wrappers are
        `display: contents`, so `order-*` stacks: chart, order form, trades,
        bottom panel. From lg they are real columns.
      */}
      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <aside className="hidden w-56 shrink-0 border-r border-border/50 lg:block">
          <MarketSelector selectedMint={mint} />
        </aside>

        <div className="contents lg:flex lg:min-w-0 lg:flex-1 lg:flex-col">
          <section aria-label="Price chart" className="order-1 h-[55vh] min-h-[320px] lg:order-none lg:h-auto lg:min-h-0 lg:flex-1">
            <PriceChart mint={mint} />
          </section>
          <section aria-label="Balances and orders" className="order-4 min-h-64 border-t border-border/50 lg:order-none lg:h-60 lg:min-h-0 lg:shrink-0 lg:overflow-hidden">
            <BottomPanel mint={mint} />
          </section>
        </div>

        <div className="contents lg:flex lg:w-80 lg:shrink-0 lg:flex-col lg:border-l lg:border-border/50">
          <section aria-label="Recent trades" className="order-3 h-80 border-t border-border/50 lg:order-none lg:h-auto lg:min-h-40 lg:flex-1 lg:border-t-0 lg:overflow-hidden">
            <TradesPanel token={base} mint={mint} />
          </section>
          <section aria-label="Place order" className="order-2 border-t border-border/50 lg:order-none lg:max-h-[75%] lg:shrink-0 lg:overflow-y-auto">
            <TradePanelSlot base={base} notFound={notFound} failed={failed} />
          </section>
        </div>
      </div>
    </div>
  );
}
