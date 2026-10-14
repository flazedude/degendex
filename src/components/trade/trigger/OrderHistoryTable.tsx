"use client";

import { useState } from "react";
import { ChevronLeft, ChevronRight, RefreshCw } from "lucide-react";
import { useArmedConfirm } from "@/components/swap/useArmedConfirm";
import { useTriggerActions } from "@/hooks/useTriggerActions";
import { useTriggerOrderHistory } from "@/hooks/useTriggerOrders";
import type { TriggerFamily } from "@/lib/jupiter/trigger/types";
import { cn } from "@/lib/utils";
import { TriggerGate } from "./TriggerConsentDialog";
import {
  EventLinks,
  PairCell,
  RowActions,
  StatusChip,
  TableMessage,
  TableSkeleton,
  TriggerCell,
  TypeCell,
  useRowsMetadata,
} from "./orderCells";
import {
  fillPercentText,
  formatBaseAmount,
  formatDateTime,
  pageRangeText,
  rowKey,
  tokenFor,
} from "./triggerFormat";

const PAGE_SIZE = 20;
const FAMILIES: { id: TriggerFamily; label: string }[] = [
  { id: "price", label: "Limit" },
  { id: "dca", label: "DCA" },
];

const GRID =
  "grid grid-cols-[4.5rem_minmax(0,0.9fr)_minmax(0,1.1fr)_minmax(0,1.1fr)_minmax(0,0.9fr)_2.75rem_minmax(0,1fr)_6.5rem_minmax(0,1.3fr)_4.75rem] items-center gap-x-3";

function HistoryRows({ family }: { family: TriggerFamily }) {
  const [offset, setOffset] = useState(0);
  // Reset to the first page when the family changes.
  const [pageFamily, setPageFamily] = useState(family);
  if (pageFamily !== family) {
    setPageFamily(family);
    setOffset(0);
  }
  const history = useTriggerOrderHistory({ family, limit: PAGE_SIZE, offset });
  const actions = useTriggerActions();
  const confirm = useArmedConfirm();
  const metadata = useRowsMetadata(history.rows);
  const rows = history.rows;

  let body: React.ReactNode;
  if (history.isLoading) body = <TableSkeleton />;
  else if (history.error && rows.length === 0) {
    body = (
      <TableMessage onRetry={history.refetch} retrying={history.isFetching}>
        Couldn&apos;t load order history from Jupiter. {history.error}
      </TableMessage>
    );
  } else if (rows.length === 0) {
    body = <TableMessage>No past {family === "price" ? "limit" : "DCA"} orders</TableMessage>;
  } else {
    body = (
      <div role="list" aria-label="Order history" className={cn(history.isFetching && "opacity-70")}>
        {rows.map((r) => {
          const inTok = tokenFor(r.inputMint, metadata);
          const outTok = tokenFor(r.outputMint, metadata);
          return (
            <div
              role="listitem"
              key={rowKey(r)}
              className={cn(
                GRID,
                "border-l-2 px-3 py-1 text-[11px]",
                r.canWithdraw ? "border-l-yellow-500 bg-yellow-500/5" : "border-l-transparent"
              )}
            >
              <TypeCell row={r} />
              <PairCell row={r} metadata={metadata} />
              <span className="truncate text-right font-mono tabular-nums">
                {formatBaseAmount(r.inputAmountInitial, inTok)}
              </span>
              <span className="truncate text-right font-mono tabular-nums">
                {r.outputAmountReceived !== null ? formatBaseAmount(r.outputAmountReceived, outTok) : "—"}
              </span>
              <span className="text-right">
                <TriggerCell row={r} />
              </span>
              <span className="text-right font-mono tabular-nums">{fillPercentText(r)}</span>
              <span className="min-w-0">
                <StatusChip row={r} />
              </span>
              <span className="truncate font-mono tabular-nums text-muted-foreground">
                {formatDateTime(r.updatedAt || r.createdAt)}
              </span>
              <span className="min-w-0 text-[10px]">
                <EventLinks row={r} />
              </span>
              <span className="flex justify-end">
                {r.canWithdraw ? (
                  <RowActions row={r} actions={actions} confirm={confirm} />
                ) : (
                  <span className="text-[10px] text-muted-foreground">—</span>
                )}
              </span>
            </div>
          );
        })}
      </div>
    );
  }

  const canPrev = offset > 0;
  const canNext = history.hasMore;
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-x-auto">
        <div className="min-w-[900px]">
          <div
            className={cn(
              GRID,
              "sticky top-0 z-10 border-b border-border/50 bg-card px-3 py-1 text-[10px] text-muted-foreground"
            )}
          >
            <span>Type</span>
            <span>Pair</span>
            <span className="text-right">Paid</span>
            <span className="text-right">Received</span>
            <span className="text-right">Trigger / rounds</span>
            <span className="text-right">Filled</span>
            <span>Status</span>
            <span>Updated</span>
            <span>Transactions</span>
            <span className="text-right">Action</span>
          </div>
          {body}
        </div>
      </div>
      <div className="mt-auto flex items-center gap-2 border-t border-border/50 px-3 py-1 text-[10px] text-muted-foreground">
        <span className="font-mono">{pageRangeText(offset, rows.length, history.total)}</span>
        {history.error && rows.length > 0 && <span className="text-yellow-500">{history.error}</span>}
        <span className="ml-auto flex items-center gap-1">
          <button
            type="button"
            onClick={history.refetch}
            disabled={history.isFetching}
            title="Refresh history"
            className="inline-flex h-5 w-5 items-center justify-center hover:text-foreground disabled:opacity-50"
          >
            <RefreshCw className={cn("h-3 w-3", history.isFetching && "animate-spin")} />
          </button>
          <button
            type="button"
            onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
            disabled={!canPrev || history.isFetching}
            aria-label="Previous page"
            className="inline-flex h-5 w-5 items-center justify-center border border-border/50 hover:text-foreground disabled:opacity-40"
          >
            <ChevronLeft className="h-3 w-3" />
          </button>
          <button
            type="button"
            onClick={() => setOffset(offset + PAGE_SIZE)}
            disabled={!canNext || history.isFetching}
            aria-label="Next page"
            className="inline-flex h-5 w-5 items-center justify-center border border-border/50 hover:text-foreground disabled:opacity-40"
          >
            <ChevronRight className="h-3 w-3" />
          </button>
        </span>
      </div>
    </div>
  );
}

function History() {
  const [family, setFamily] = useState<TriggerFamily>("price");
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center gap-1 border-b border-border/50 px-3 py-1">
        {FAMILIES.map((f) => (
          <button
            key={f.id}
            type="button"
            aria-pressed={family === f.id}
            onClick={() => setFamily(f.id)}
            className={cn(
              "border px-2 py-0 text-[10px] leading-4 transition-colors",
              family === f.id
                ? "border-primary/60 bg-primary/10 text-primary"
                : "border-border/50 text-muted-foreground hover:text-foreground"
            )}
          >
            {f.label}
          </button>
        ))}
      </div>
      <HistoryRows family={family} />
    </div>
  );
}

/** Past limit / DCA orders, one family at a time, paginated. */
export function OrderHistoryTable() {
  return (
    <TriggerGate layout="centered" intro="Your past limit and DCA orders show up here once enabled.">
      <History />
    </TriggerGate>
  );
}
