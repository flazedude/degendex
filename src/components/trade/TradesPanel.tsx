"use client";

import { memo } from "react";
import { ExternalLink, RefreshCw } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { useMarketTrades } from "@/hooks/useMarketTrades";
import { isValidPubkey } from "@/lib/jupiter/params";
import { MarketFetchError } from "@/lib/markets/client";
import type { MarketTrade } from "@/lib/markets/types";
import type { TokenInfo } from "@/lib/tokens/types";
import { cn, shortenAddress } from "@/lib/utils";
import {
  dexLabel,
  formatCompactAmount,
  formatUsdPrice,
  formatUsdValue,
  geckoPoolUrl,
  isTradesDelayed,
  solscanTxUrl,
  timeAgo,
} from "./tradesFormat";
import { useRelativeClock } from "./useRelativeClock";

/** Rows rendered; the route returns up to ~300 (a few minutes on busy pools). */
const MAX_ROWS = 100;
const GRID = "grid grid-cols-[2.25rem_minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1fr)] gap-x-2";

function errorText(error: unknown): string {
  if (error instanceof MarketFetchError) {
    if (error.status === 429 || error.status === 503) {
      return "Trade data provider is busy or unavailable. Retrying every minute.";
    }
    if (error.status === 404) return "No trade data for this token.";
  }
  return "Couldn't load recent trades.";
}

const TradeRow = memo(function TradeRow({ trade, now }: { trade: MarketTrade; now: number }) {
  const href = solscanTxUrl(trade.txHash);
  const buy = trade.side === "buy";
  const sideClass = buy ? "text-primary" : "text-destructive";
  const content = (
    <>
      <span className="text-muted-foreground" title={new Date(trade.ts).toLocaleString()}>
        {timeAgo(trade.ts, now)}
      </span>
      <span className={cn("truncate text-right", sideClass)}>
        <span className="sr-only">{buy ? "Buy at " : "Sell at "}</span>
        {formatUsdPrice(trade.priceUsd)}
      </span>
      <span className="truncate text-right text-foreground/90" title={String(trade.amount)}>
        {formatCompactAmount(trade.amount)}
      </span>
      <span className={cn("truncate text-right", sideClass)}>{formatUsdValue(trade.volumeUsd)}</span>
    </>
  );
  const rowClass = cn(GRID, "px-3 py-[3px] font-mono text-[10px] leading-4 tabular-nums");
  return href ? (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      title="View transaction on Solscan"
      className={cn(rowClass, "hover:bg-muted/40 focus-visible:bg-muted/40 focus-visible:outline-none")}
    >
      {content}
    </a>
  ) : (
    <div className={rowClass}>{content}</div>
  );
});

function Message({ children, action }: { children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-1.5 px-3 py-6 text-center">
      <p className="text-[11px] text-muted-foreground">{children}</p>
      {action}
    </div>
  );
}

/**
 * Recent on-chain swaps of `mint` on its top GeckoTerminal pool, newest
 * first, polled every minute. Not an order book: one pool, a few minutes.
 */
export function TradesPanel({ token, mint }: { token: TokenInfo | null; mint: string }) {
  const query = useMarketTrades(mint);
  const { data, error, isPending, isError, isFetching, refetch } = query;
  const now = useRelativeClock();

  const pool = data?.pool ?? null;
  const dex = dexLabel(pool?.dex);
  const poolUrl = geckoPoolUrl(pool?.address);
  const trades = data?.trades ?? [];
  const delayed = isTradesDelayed(data, isError && !!data, now);
  const lastAge = trades[0] && now > 0 && pool ? timeAgo(trades[0].ts, now) : null;
  const symbol = token?.mint === mint ? token.symbol : null;

  let body: React.ReactNode;
  if (!isValidPubkey(mint)) {
    body = <Message>Invalid token address.</Message>;
  } else if (isPending) {
    body = (
      <div className="space-y-1.5 px-3 py-2" aria-busy="true" aria-label="Loading recent trades">
        {Array.from({ length: 10 }, (_, i) => (
          <Skeleton key={i} className="h-3 w-full rounded-none bg-muted/60" />
        ))}
      </div>
    );
  } else if (!data) {
    body = (
      <Message
        action={
          <button
            type="button"
            onClick={() => void refetch()}
            disabled={isFetching}
            className="inline-flex items-center gap-1 border border-border/50 px-2 py-0.5 text-[10px] text-muted-foreground hover:text-foreground disabled:opacity-50"
          >
            <RefreshCw className={cn("h-3 w-3", isFetching && "animate-spin")} />
            Retry
          </button>
        }
      >
        {errorText(error)}
      </Message>
    );
  } else if (!pool) {
    body = <Message>No on-chain pool found for this token, so there are no trades to show.</Message>;
  } else if (trades.length === 0) {
    body = <Message>No recent trades on this pool</Message>;
  } else {
    body = (
      <>
        <div
          className={cn(
            GRID,
            "sticky top-0 z-10 border-b border-border/50 bg-card px-3 py-1 text-[10px] text-muted-foreground"
          )}
        >
          <span>Time</span>
          <span className="text-right">Price</span>
          <span className="truncate text-right">Amount{symbol ? ` (${symbol})` : ""}</span>
          <span className="text-right">Value</span>
        </div>
        <div role="list" aria-label="Recent trades">
          {trades.slice(0, MAX_ROWS).map((t) => (
            <div role="listitem" key={t.id}>
              <TradeRow trade={t} now={now} />
            </div>
          ))}
        </div>
        {trades.length > MAX_ROWS && (
          <p className="px-3 py-1.5 text-[10px] text-muted-foreground">
            Showing the latest {MAX_ROWS} of {trades.length} trades
          </p>
        )}
      </>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-card/30">
      <div className="shrink-0 border-b border-border/50 px-3 py-1.5">
        <div className="flex items-center gap-2">
          <h2 className="truncate text-[11px] font-medium">
            Recent trades{dex ? ` · ${dex} pool` : ""}
          </h2>
          {delayed && (
            <span
              className="shrink-0 border border-yellow-500/40 bg-yellow-500/10 px-1 text-[9px] font-medium uppercase tracking-wide text-yellow-500"
              title={
                data?.updatedAt
                  ? `Trade data could not be refreshed. Last updated ${new Date(data.updatedAt).toLocaleTimeString()}.`
                  : "Trade data could not be refreshed."
              }
            >
              Delayed
            </span>
          )}
          {poolUrl && pool && (
            <a
              href={poolUrl}
              target="_blank"
              rel="noopener noreferrer"
              title={`Pool ${pool.address} on GeckoTerminal`}
              className="ml-auto inline-flex shrink-0 items-center gap-0.5 font-mono text-[10px] text-muted-foreground hover:text-foreground"
            >
              {shortenAddress(pool.address)}
              <ExternalLink className="h-2.5 w-2.5" />
            </a>
          )}
        </div>
        <p className="flex items-center justify-between gap-2 pt-0.5 text-[10px] text-muted-foreground">
          <span className="truncate">On-chain swaps on one pool, refreshed every minute</span>
          {lastAge && (
            <span className="shrink-0 font-mono">
              {lastAge === "now" ? "last trade just now" : `last trade ${lastAge} ago`}
            </span>
          )}
        </p>
      </div>
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">{body}</div>
      <p className="shrink-0 border-t border-border/50 px-3 py-0.5 text-[9px] text-muted-foreground">
        Data:{" "}
        <a
          href="https://www.geckoterminal.com/"
          target="_blank"
          rel="noopener noreferrer"
          className="hover:text-foreground"
        >
          GeckoTerminal
        </a>
      </p>
    </div>
  );
}
