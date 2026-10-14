"use client";

import { useMemo } from "react";
import { RefreshCw } from "lucide-react";
import { useArmedConfirm } from "@/components/swap/useArmedConfirm";
import { useTriggerActions } from "@/hooks/useTriggerActions";
import { useTriggerOrders } from "@/hooks/useTriggerOrders";
import { safeBigNumber } from "@/lib/amounts";
import { MAX_ACTIVE_DCA } from "@/lib/jupiter/trigger/config";
import type { TriggerOrderRow } from "@/lib/jupiter/trigger/types";
import type { TokenInfo } from "@/lib/tokens/types";
import { cn } from "@/lib/utils";
import { useRelativeClock } from "../useRelativeClock";
import { TriggerGate } from "./TriggerConsentDialog";
import {
  CardLine,
  OrderCard,
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
  formatCountdown,
  mergeOpenRows,
  rowKey,
  tokenFor,
} from "./triggerFormat";

const GRID =
  "grid grid-cols-[4.5rem_minmax(0,0.9fr)_minmax(0,1.4fr)_minmax(0,1fr)_2.75rem_4.5rem_minmax(0,1fr)_4.75rem] items-center gap-x-3";

function AmountCell({ row, metadata }: { row: TriggerOrderRow; metadata?: Record<string, TokenInfo> }) {
  const token = tokenFor(row.inputMint, metadata);
  const remaining = formatBaseAmount(row.inputAmountRemaining, token);
  const partial =
    safeBigNumber(row.inputAmountRemaining).lt(safeBigNumber(row.inputAmountInitial)) &&
    safeBigNumber(row.inputAmountRemaining).gt(0);
  return (
    <span
      className="truncate font-mono tabular-nums"
      title={partial ? `${remaining} left of ${formatBaseAmount(row.inputAmountInitial, token)}` : remaining}
    >
      {remaining}
      {partial && (
        <span className="text-muted-foreground"> / {formatBaseAmount(row.inputAmountInitial, token, { withSymbol: false })}</span>
      )}
    </span>
  );
}

function TimeCell({ row, now }: { row: TriggerOrderRow; now: number }) {
  if (row.family === "price") {
    if (!row.expiresAt) return <span className="text-muted-foreground">—</span>;
    const left = formatCountdown(row.expiresAt, now, "expired");
    return (
      <span
        className={cn("truncate font-mono tabular-nums", left === "expired" && "text-yellow-500")}
        title={`Expires ${new Date(row.expiresAt).toLocaleString()}`}
      >
        {left}
      </span>
    );
  }
  if (!row.nextFillAt) return <span className="text-muted-foreground">—</span>;
  return (
    <span className="truncate font-mono tabular-nums" title={`Next round ${new Date(row.nextFillAt).toLocaleString()}`}>
      {formatCountdown(row.nextFillAt, now, "due")}
    </span>
  );
}

function Rows() {
  const orders = useTriggerOrders();
  const actions = useTriggerActions();
  const confirm = useArmedConfirm();
  const now = useRelativeClock();
  const rows = useMemo(
    () => mergeOpenRows(orders.activeRows, orders.needsWithdraw),
    [orders.activeRows, orders.needsWithdraw]
  );
  const metadata = useRowsMetadata(rows);

  if (orders.isLoading) return <TableSkeleton />;
  if (orders.error && rows.length === 0) {
    return (
      <TableMessage onRetry={() => void orders.refetch()} retrying={orders.isFetching}>
        Couldn&apos;t load your orders from Jupiter. {orders.error}
      </TableMessage>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Below sm: stacked cards, so status and the Withdraw / Cancel button
          are always on screen (the table needs ~760px). */}
      <div className="min-h-0 flex-1 overflow-y-auto sm:hidden">
        {rows.length === 0 ? (
          <TableMessage>No open limit or DCA orders</TableMessage>
        ) : (
          <div role="list" aria-label="Open orders">
            {rows.map((r) => (
              <OrderCard
                key={rowKey(r)}
                row={r}
                metadata={metadata}
                action={<RowActions row={r} actions={actions} confirm={confirm} />}
              >
                <CardLine label="Amount">
                  <AmountCell row={r} metadata={metadata} />
                </CardLine>
                <CardLine label={r.family === "price" ? "Trigger" : "Rounds"}>
                  <TriggerCell row={r} />
                </CardLine>
                <CardLine label="Filled">
                  <span className="font-mono tabular-nums">{fillPercentText(r)}</span>
                </CardLine>
                <CardLine label={r.family === "price" ? "Expires" : "Next round"}>
                  <TimeCell row={r} now={now} />
                </CardLine>
              </OrderCard>
            ))}
          </div>
        )}
      </div>
      <div className="hidden min-h-0 flex-1 overflow-x-auto sm:block">
        <div className="min-w-[760px]">
          <div
            className={cn(
              GRID,
              "sticky top-0 z-10 border-b border-border/50 bg-card px-3 py-1 text-[10px] text-muted-foreground"
            )}
          >
            <span>Type</span>
            <span>Pair</span>
            <span className="text-right">Amount</span>
            <span className="text-right">Trigger / rounds</span>
            <span className="text-right">Filled</span>
            <span className="text-right">Expires / next</span>
            <span>Status</span>
            <span className="text-right">Action</span>
          </div>
          {rows.length === 0 ? (
            <TableMessage>No open limit or DCA orders</TableMessage>
          ) : (
            <div role="list" aria-label="Open orders">
              {rows.map((r) => (
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
                  <span className="text-right">
                    <AmountCell row={r} metadata={metadata} />
                  </span>
                  <span className="text-right">
                    <TriggerCell row={r} />
                  </span>
                  <span className="text-right font-mono tabular-nums">{fillPercentText(r)}</span>
                  <span className="text-right">
                    <TimeCell row={r} now={now} />
                  </span>
                  <span className="min-w-0">
                    <StatusChip row={r} />
                  </span>
                  <span className="flex justify-end">
                    <RowActions row={r} actions={actions} confirm={confirm} />
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
      <div className="mt-auto flex flex-wrap items-center gap-x-3 gap-y-0.5 border-t border-border/50 px-3 py-1 text-[10px] text-muted-foreground">
        <span>
          DCA <span className="font-mono text-foreground/90">{orders.activeDcaCount}</span>/{MAX_ACTIVE_DCA} active
        </span>
        {orders.needsWithdraw.length > 0 && (
          <span className="text-yellow-500">
            {orders.needsWithdraw.length} order{orders.needsWithdraw.length === 1 ? "" : "s"} with funds to withdraw
          </span>
        )}
        {orders.error && rows.length > 0 && <span className="text-yellow-500">{orders.error}</span>}
        <span className="hidden sm:inline">Amount is what is still held in the Jupiter vault.</span>
        <button
          type="button"
          onClick={() => void orders.refetch()}
          disabled={orders.isFetching}
          title="Refresh orders (auto every 30s)"
          className="ml-auto inline-flex items-center gap-1 hover:text-foreground disabled:opacity-50"
        >
          <RefreshCw className={cn("h-3 w-3", orders.isFetching && "animate-spin")} />
          Refresh
        </button>
      </div>
    </div>
  );
}

/** Active limit + DCA orders, plus anything waiting for a withdraw. */
export function OpenOrdersTable() {
  return (
    <TriggerGate layout="centered" intro="Your limit and DCA orders show up here once enabled.">
      <Rows />
    </TriggerGate>
  );
}
