"use client";

import { useState } from "react";
import { Activity, BookOpen, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

import type { Market } from "@/app/trade/page";

interface OrderBookProps {
  market: Market;
}

// No live depth or fills feed is connected yet, so both tabs show an empty state
// instead of numbers. Never render placeholder prices here.
export function OrderBook({ market }: OrderBookProps) {
  const [tab, setTab] = useState<"book" | "trades">("book");

  return (
    <div className="flex flex-col h-full">
      {/* Tabs */}
      <div className="flex border-b border-border/50 shrink-0">
        <button
          onClick={() => setTab("book")}
          className={cn(
            "flex-1 py-1.5 text-[11px] font-medium transition-colors",
            tab === "book" ? "text-foreground border-b border-primary" : "text-muted-foreground hover:text-foreground"
          )}
        >
          Order Book
        </button>
        <button
          onClick={() => setTab("trades")}
          className={cn(
            "flex-1 py-1.5 text-[11px] font-medium transition-colors",
            tab === "trades" ? "text-foreground border-b border-primary" : "text-muted-foreground hover:text-foreground"
          )}
        >
          Trades
        </button>
      </div>

      {tab === "book" ? (
        <div className="flex-1 flex flex-col min-h-0">
          <ColumnHeader columns={["Price", `Size (${market.base})`, "Total"]} />
          <EmptyState
            icon={BookOpen}
            title="On-chain order book coming soon"
            detail={`No depth is shown for ${market.label} until a live on-chain feed is connected.`}
          />
        </div>
      ) : (
        <div className="flex-1 flex flex-col min-h-0">
          <ColumnHeader columns={["Price", "Size", "Time"]} />
          <EmptyState
            icon={Activity}
            title="Live trades coming soon"
            detail={`Fills for ${market.base} will stream here once a live feed is connected.`}
          />
        </div>
      )}
    </div>
  );
}

function ColumnHeader({ columns }: { columns: [string, string, string] }) {
  return (
    <div className="grid grid-cols-3 px-2 py-1 text-[10px] text-muted-foreground/60 border-b border-border/30 shrink-0">
      <span>{columns[0]}</span>
      <span className="text-right">{columns[1]}</span>
      <span className="text-right">{columns[2]}</span>
    </div>
  );
}

function EmptyState({ icon: Icon, title, detail }: { icon: LucideIcon; title: string; detail: string }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-1.5 px-4 py-6 text-center">
      <div className="flex h-8 w-8 items-center justify-center border border-dashed border-border text-muted-foreground">
        <Icon className="h-3.5 w-3.5" />
      </div>
      <p className="text-[11px] font-medium text-foreground">{title}</p>
      <p className="max-w-[210px] text-[10px] leading-snug text-muted-foreground">{detail}</p>
    </div>
  );
}
