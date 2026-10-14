"use client";

import { createContext, useContext, useMemo } from "react";
import { ArrowUpRight, Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useArmedConfirm } from "@/components/swap/useArmedConfirm";
import { useTokenMetadata } from "@/hooks/useTokenMetadata";
import type { TriggerPendingAction, UseTriggerActionsResult } from "@/hooks/useTriggerActions";
import { JUPITER_APP_URL } from "@/lib/jupiter/trigger/config";
import type { TriggerOrderRow } from "@/lib/jupiter/trigger/types";
import type { TokenInfo } from "@/lib/tokens/types";
import { cn } from "@/lib/utils";
import { formatUsdPrice } from "../tradesFormat";
import {
  FUNDS_MAY_BE_HELD_NOTE,
  TONE_CLASS,
  baseMintOf,
  cancelLabel,
  eventLabel,
  formatDateTime,
  formatInterval,
  orderTypeLabel,
  rowKey,
  rowSide,
  solscanTx,
  statusChip,
  symbolFor,
} from "./triggerFormat";

/** Jupiter metadata for every mint in `rows` (curated list as fallback in symbolFor). */
export function useRowsMetadata(rows: readonly TriggerOrderRow[]): Record<string, TokenInfo> | undefined {
  const mints = useMemo(() => {
    const set = new Set<string>();
    for (const r of rows) {
      set.add(r.inputMint);
      set.add(r.outputMint);
    }
    return [...set].sort();
  }, [rows]);
  return useTokenMetadata(mints).data;
}

export function TypeCell({ row, className }: { row: TriggerOrderRow; className?: string }) {
  const side = rowSide(row);
  return (
    <span
      className={cn(
        className,
        "truncate font-medium",
        side === "buy" ? "text-primary" : side === "sell" ? "text-destructive" : "text-foreground"
      )}
    >
      {orderTypeLabel(row)}
    </span>
  );
}

export function PairCell({
  row,
  metadata,
  className,
}: {
  row: TriggerOrderRow;
  metadata?: Record<string, TokenInfo>;
  className?: string;
}) {
  const baseMint = baseMintOf(row);
  const quoteMint = baseMint === row.inputMint ? row.outputMint : row.inputMint;
  return (
    <span className={cn("truncate", className)} title={`${row.inputMint} → ${row.outputMint}`}>
      <span className="font-medium">{symbolFor(baseMint, metadata)}</span>
      <span className="text-muted-foreground">/{symbolFor(quoteMint, metadata)}</span>
    </span>
  );
}

/** "≤ $150.00" for limit orders, "2 / 4 · every day" for DCA. */
export function TriggerCell({ row }: { row: TriggerOrderRow }) {
  if (row.family === "price") {
    if (row.triggerPriceUsd === undefined) return <span className="text-muted-foreground">—</span>;
    const op = row.triggerCondition === "below" ? "≤" : row.triggerCondition === "above" ? "≥" : "";
    return (
      <span className="truncate font-mono tabular-nums" title="Trigger: USD price">
        {op} {formatUsdPrice(row.triggerPriceUsd)}
      </span>
    );
  }
  const rounds = row.orderCount ? `${row.roundsFilled ?? 0}/${row.orderCount}` : "—";
  return (
    <span
      className="truncate font-mono tabular-nums"
      title={row.intervalSeconds ? formatInterval(row.intervalSeconds) : undefined}
    >
      {rounds}
      {row.intervalSeconds ? (
        <span className="text-muted-foreground"> · {formatInterval(row.intervalSeconds).replace("every ", "")}</span>
      ) : null}
    </span>
  );
}

export function StatusChip({ row }: { row: TriggerOrderRow }) {
  const chip = statusChip(row);
  return (
    <span
      title={chip.title}
      className={cn("inline-block max-w-full truncate border px-1 text-[10px] leading-4", TONE_CLASS[chip.tone])}
    >
      {chip.label}
    </span>
  );
}

/** Solscan links for the row's events that carry a transaction. */
export function EventLinks({ row, max = 3 }: { row: TriggerOrderRow; max?: number }) {
  const withTx = row.events.filter((e) => solscanTx(e.txSignature));
  if (withTx.length === 0) return <span className="text-muted-foreground">—</span>;
  const shown = withTx.slice(-max);
  return (
    <span className="flex min-w-0 flex-wrap gap-x-1.5">
      {shown.map((e, i) => (
        <a
          key={`${e.txSignature}-${i}`}
          href={solscanTx(e.txSignature)!}
          target="_blank"
          rel="noopener noreferrer"
          title={`${eventLabel(e.type)}${e.ts ? ` · ${formatDateTime(e.ts)}` : ""}${e.state ? ` · ${e.state}` : ""} on Solscan`}
          className={cn(
            "inline-flex items-center gap-0.5 hover:text-primary",
            e.state === "failed" ? "text-destructive/80" : "text-muted-foreground"
          )}
        >
          {eventLabel(e.type)}
          <ArrowUpRight className="h-2.5 w-2.5" />
        </a>
      ))}
      {withTx.length > shown.length && (
        <span className="text-muted-foreground" title={`${withTx.length} transactions in total`}>
          +{withTx.length - shown.length}
        </span>
      )}
    </span>
  );
}

function isPendingFor(pending: TriggerPendingAction | null, row: TriggerOrderRow, kind: "cancel" | "withdraw") {
  return pending?.kind === kind && pending.orderId === row.id;
}

/** Link to jup.ag, which manages the same per-wallet vault. */
export function JupiterPointer({ title, label = "jup.ag" }: { title?: string; label?: string }) {
  return (
    <a
      href={JUPITER_APP_URL}
      target="_blank"
      rel="noopener noreferrer"
      title={title}
      className="inline-flex items-center gap-0.5 text-[10px] text-yellow-500 hover:underline"
    >
      {label} <ArrowUpRight className="h-2.5 w-2.5" />
    </a>
  );
}

/**
 * Withdraw (highlighted), Cancel (two-click; "Cancel & withdraw" for
 * unrecognised states), or a jup.ag pointer when funds may be held after a
 * failure. Disabled buttons say why in their tooltip.
 */
export function RowActions({
  row,
  actions,
  confirm,
}: {
  row: TriggerOrderRow;
  actions: Pick<UseTriggerActionsResult, "cancelOrder" | "withdraw" | "pending" | "isBusy" | "busyReason">;
  confirm: ReturnType<typeof useArmedConfirm>;
}) {
  const base = "h-5 rounded-none px-1.5 text-[10px] font-semibold";
  const waitTitle = actions.isBusy ? (actions.busyReason ?? "Another order action is running") : null;
  if (row.canWithdraw) {
    const running = isPendingFor(actions.pending, row, "withdraw");
    return (
      <Button
        size="xs"
        onClick={() => void actions.withdraw(row)}
        disabled={actions.isBusy}
        title={running ? undefined : (waitTitle ?? "Return the funds held in the Jupiter vault to your wallet")}
        className={cn(base, "bg-yellow-500 text-black hover:bg-yellow-400")}
      >
        {running && <Loader2 className="h-3 w-3 animate-spin" />}
        {running ? "Withdrawing" : "Withdraw"}
      </Button>
    );
  }
  if (row.canCancel) {
    const running = isPendingFor(actions.pending, row, "cancel");
    const key = rowKey(row);
    const armed = confirm.armedId === key;
    const unknown = row.status === "unknown";
    return (
      <Button
        size="xs"
        variant="outline"
        onClick={() => {
          if (confirm.press(key)) void actions.cancelOrder(row);
        }}
        disabled={actions.isBusy}
        title={
          running
            ? undefined
            : (waitTitle ??
              (unknown
                ? "Status not recognised. Cancels the order (if it is still live) and returns what it holds (needs a wallet signature)"
                : "Stops the order and returns the unfilled amount (needs a wallet signature)"))
        }
        className={cn(
          base,
          "border-border/60 bg-transparent",
          armed ? "border-destructive/60 text-destructive" : "text-muted-foreground hover:text-foreground"
        )}
      >
        {running && <Loader2 className="h-3 w-3 animate-spin" />}
        {running ? "Cancelling" : armed ? "Confirm?" : cancelLabel(row)}
      </Button>
    );
  }
  if (row.fundsMayBeHeld) return <JupiterPointer title={FUNDS_MAY_BE_HELD_NOTE} />;
  return <span className="text-[10px] text-muted-foreground">—</span>;
}

// --- One row, two layouts ------------------------------------------------------
//
// The tables follow their CONTAINER's width (Tailwind container queries; the
// table component's root carries `@container`), not the viewport: in the
// terminal the account panel can be ~480px wide on a 1024px screen. Each order
// renders ONCE: a stacked card in a narrow container, turned into a grid row
// from the breakpoint up (wrappers become `display: contents`, cells are put
// in column order with `order`). No hidden duplicate buttons or timers.

/**
 * Container-query class sets per breakpoint. Literal strings so Tailwind
 * generates them: "open" switches at 48rem, "history" at 56rem.
 */
const WIDE = {
  open: {
    row: "@[48rem]:grid @[48rem]:items-center @[48rem]:border-b-0 @[48rem]:py-1",
    contents: "@[48rem]:contents",
    narrowOnly: "@[48rem]:hidden",
    wideGrid: "hidden @[48rem]:grid",
    wideInline: "hidden @[48rem]:inline",
    left: "@[48rem]:text-left",
    text: "@[48rem]:text-[11px]",
    order: [
      "",
      "@[48rem]:order-1",
      "@[48rem]:order-2",
      "@[48rem]:order-3",
      "@[48rem]:order-4",
      "@[48rem]:order-5",
      "@[48rem]:order-6",
      "@[48rem]:order-7",
      "@[48rem]:order-8",
      "@[48rem]:order-9",
      "@[48rem]:order-10",
    ],
  },
  history: {
    row: "@[56rem]:grid @[56rem]:items-center @[56rem]:border-b-0 @[56rem]:py-1",
    contents: "@[56rem]:contents",
    narrowOnly: "@[56rem]:hidden",
    wideGrid: "hidden @[56rem]:grid",
    wideInline: "hidden @[56rem]:inline",
    left: "@[56rem]:text-left",
    text: "@[56rem]:text-[11px]",
    order: [
      "",
      "@[56rem]:order-1",
      "@[56rem]:order-2",
      "@[56rem]:order-3",
      "@[56rem]:order-4",
      "@[56rem]:order-5",
      "@[56rem]:order-6",
      "@[56rem]:order-7",
      "@[56rem]:order-8",
      "@[56rem]:order-9",
      "@[56rem]:order-10",
    ],
  },
} as const;

export type RowLayout = keyof typeof WIDE;
type WideClasses = (typeof WIDE)[RowLayout];

/** Class sets for `layout` (header row, footer notes). */
export function wideClasses(layout: RowLayout): WideClasses {
  return WIDE[layout];
}

const RowLayoutContext = createContext<WideClasses | null>(null);

/**
 * One order. Narrow container: type + pair, then status + action on the first
 * line (never off-screen), details below as label / value lines. From the
 * layout's breakpoint up: a grid row with `gridCols`; type and pair are
 * columns 1 and 2, the details follow in their `order`, and status / action
 * sit at `statusOrder` / `actionOrder`.
 */
export function OrderRow({
  row,
  metadata,
  layout,
  gridCols,
  statusOrder,
  actionOrder,
  action,
  children,
}: {
  row: TriggerOrderRow;
  metadata?: Record<string, TokenInfo>;
  layout: RowLayout;
  /** grid-cols-[...] (plus column gap) used from the breakpoint up. */
  gridCols: string;
  statusOrder: number;
  actionOrder: number;
  action: React.ReactNode;
  children?: React.ReactNode;
}) {
  const w = WIDE[layout];
  return (
    <div
      role="listitem"
      className={cn(
        "flex flex-col gap-y-0.5 border-b border-l-2 border-b-border/30 px-3 py-1.5 text-[11px]",
        gridCols,
        w.row,
        row.canWithdraw || row.fundsMayBeHeld ? "border-l-yellow-500 bg-yellow-500/5" : "border-l-transparent"
      )}
    >
      <div className={cn("flex items-center justify-between gap-2", w.contents)}>
        <span className={cn("flex min-w-0 items-center gap-1.5", w.contents)}>
          <TypeCell row={row} className={w.order[1]} />
          <PairCell row={row} metadata={metadata} className={w.order[2]} />
        </span>
        <span className={cn("flex shrink-0 items-center gap-1.5", w.contents)}>
          <span className={cn("min-w-0", w.order[statusOrder])}>
            <StatusChip row={row} />
          </span>
          <span className={cn("flex justify-end", w.order[actionOrder])}>{action}</span>
        </span>
      </div>
      <RowLayoutContext.Provider value={w}>{children}</RowLayoutContext.Provider>
    </div>
  );
}

/**
 * Label / value line inside an OrderRow; from the breakpoint up only the value
 * shows, as the grid cell at position `order`.
 */
export function CardLine({
  label,
  order = 0,
  align = "right",
  children,
}: {
  label: string;
  /** Column position in the wide layout (1-based; 1 and 2 are type and pair). */
  order?: number;
  /** Alignment of the value in the wide layout (cards are always right-aligned). */
  align?: "left" | "right";
  children: React.ReactNode;
}) {
  const w = useContext(RowLayoutContext);
  return (
    <div className={cn("flex items-baseline justify-between gap-3 text-[10px]", w?.contents, w?.text)}>
      <span className={cn("shrink-0 text-muted-foreground", w?.narrowOnly)}>{label}</span>
      <span className={cn("min-w-0 truncate text-right", w?.order[order], align === "left" && w?.left)}>
        {children}
      </span>
    </div>
  );
}

export function TableSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="space-y-1.5 px-3 py-2" aria-busy="true" aria-label="Loading orders">
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className="h-4 w-full rounded-none bg-muted/60" />
      ))}
    </div>
  );
}

export function TableMessage({
  children,
  onRetry,
  retrying,
}: {
  children: React.ReactNode;
  onRetry?: () => void;
  retrying?: boolean;
}) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 px-3 py-4 text-center">
      <p className="text-[11px] text-muted-foreground">{children}</p>
      {onRetry && (
        <Button
          size="sm"
          variant="outline"
          onClick={onRetry}
          disabled={retrying}
          className="h-6 gap-1 rounded-none px-3 text-[11px]"
        >
          <RefreshCw className={cn("h-3 w-3", retrying && "animate-spin")} />
          Retry
        </Button>
      )}
    </div>
  );
}
