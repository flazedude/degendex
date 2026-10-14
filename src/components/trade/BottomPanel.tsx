"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { RefreshCw } from "lucide-react";
import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { TokenLogo } from "@/components/swap/TokenLogo";
import { useRefreshBalances } from "@/hooks/useTokenBalance";
import { useTokenMetadata } from "@/hooks/useTokenMetadata";
import { useTokenPrices } from "@/hooks/useTokenPrices";
import { useWalletHoldings } from "@/hooks/useWalletHoldings";
import { cn, shortenAddress } from "@/lib/utils";
import { buildBalanceRows, totalValueUsd, type BalanceRow } from "./balanceRows";
import { formatPct, formatUsdPrice, formatUsdValue } from "./tradesFormat";

const TABS = [
  { id: "balances", label: "Balances" },
  { id: "open", label: "Open orders" },
  { id: "history", label: "Order history" },
] as const;
type TabId = (typeof TABS)[number]["id"];

const COMING_NEXT = "Limit orders and DCA are coming next";
const GRID =
  "grid grid-cols-[minmax(0,1.6fr)_minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1fr)_3.5rem] items-center gap-x-3";

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 px-3 py-4 text-center">{children}</div>
  );
}

function holdingsErrorText(error: unknown): string {
  const msg = error instanceof Error ? error.message : "";
  if (/429|too many requests|rate.?limit/i.test(msg)) {
    return "The Solana RPC is rate limiting balance requests. Try again in a moment.";
  }
  return "Couldn't load wallet balances from the Solana RPC.";
}

function BalanceRowView({ row }: { row: BalanceRow }) {
  const change = row.change24hPct;
  return (
    <Link
      href={`/trade?mint=${encodeURIComponent(row.mint)}`}
      scroll={false}
      aria-current={row.isCurrent ? "true" : undefined}
      title={row.isCurrent ? "Current market" : `Open the ${row.symbol} market`}
      className={cn(
        GRID,
        "border-l-2 px-3 py-1 text-[11px] hover:bg-muted/40 focus-visible:bg-muted/40 focus-visible:outline-none",
        row.isCurrent ? "border-l-primary bg-primary/5" : "border-l-transparent"
      )}
    >
      <span className="flex min-w-0 items-center gap-1.5">
        <TokenLogo symbol={row.symbol} logoURI={row.logoURI} className="h-4 w-4 text-[8px]" />
        <span className="min-w-0">
          <span className="block truncate font-medium leading-tight">{row.symbol}</span>
          {(!row.known || !row.isVerified) && (
            <span className="block truncate font-mono text-[9px] leading-tight text-muted-foreground" title={row.mint}>
              {row.known ? "Unverified · " : ""}
              {shortenAddress(row.mint)}
            </span>
          )}
        </span>
      </span>
      <span className="truncate text-right font-mono tabular-nums" title={`${row.ui} ${row.symbol}`}>
        {row.balance}
      </span>
      <span className="truncate text-right font-mono tabular-nums text-muted-foreground">
        {formatUsdPrice(row.priceUsd)}
      </span>
      <span className="truncate text-right font-mono tabular-nums">{formatUsdValue(row.valueUsd)}</span>
      <span
        className={cn(
          "truncate text-right font-mono tabular-nums",
          change === null ? "text-muted-foreground" : change > 0 ? "text-primary" : change < 0 ? "text-destructive" : ""
        )}
      >
        {formatPct(change)}
      </span>
    </Link>
  );
}

function Balances({ mint }: { mint: string }) {
  const { connected, connecting } = useWallet();
  const { setVisible } = useWalletModal();
  const holdings = useWalletHoldings();
  const refresh = useRefreshBalances();
  const [showSmall, setShowSmall] = useState(false);

  const mints = useMemo(() => (holdings.data ?? []).map((h) => h.mint), [holdings.data]);
  const metadata = useTokenMetadata(mints);
  // Jupiter only prices tokens it lists, so skip mints with no metadata (spam
  // airdrops) instead of spending the shared price budget on them. If the
  // metadata call fails, price everything rather than show nothing.
  const priceMints = useMemo(() => {
    if (metadata.data) return mints.filter((m) => metadata.data[m]);
    return metadata.isError ? mints : [];
  }, [mints, metadata.data, metadata.isError]);
  const prices = useTokenPrices(priceMints);

  const rows = useMemo(
    () => buildBalanceRows(holdings.data ?? [], metadata.data, prices.data, mint),
    [holdings.data, metadata.data, prices.data, mint]
  );
  const visible = showSmall ? rows : rows.filter((r) => !r.isDust);
  const hiddenCount = rows.length - rows.filter((r) => !r.isDust).length;
  const total = totalValueUsd(rows);
  const unpriced = rows.filter((r) => r.valueUsd === null && !r.isDust).length;

  if (!connected) {
    return (
      <Centered>
        <p className="text-[11px] text-muted-foreground">Connect wallet to view balances</p>
        <Button
          size="sm"
          onClick={() => setVisible(true)}
          disabled={connecting}
          className="h-6 rounded-none px-3 text-[11px]"
        >
          {connecting ? "Connecting..." : "Connect Wallet"}
        </Button>
      </Centered>
    );
  }

  if (holdings.isPending) {
    return (
      <div className="space-y-1.5 px-3 py-2" aria-busy="true" aria-label="Loading balances">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-4 w-full rounded-none bg-muted/60" />
        ))}
      </div>
    );
  }

  if (!holdings.data) {
    return (
      <Centered>
        <p className="text-[11px] text-muted-foreground">{holdingsErrorText(holdings.error)}</p>
        <Button
          size="sm"
          variant="outline"
          onClick={() => void holdings.refetch()}
          disabled={holdings.isFetching}
          className="h-6 gap-1 rounded-none px-3 text-[11px]"
        >
          <RefreshCw className={cn("h-3 w-3", holdings.isFetching && "animate-spin")} />
          Retry
        </Button>
      </Centered>
    );
  }

  const notes: string[] = [];
  if (holdings.isError) notes.push("Balances could not be refreshed; showing the last loaded values.");
  if (prices.isError && !prices.data) notes.push("Prices unavailable right now.");
  else if (prices.isError) notes.push("Prices could not be refreshed and may be delayed.");
  if (metadata.isError && !metadata.data) notes.push("Token names unavailable; showing mint addresses.");

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div
        className={cn(
          GRID,
          "sticky top-0 z-10 border-b border-border/50 bg-card px-3 py-1 text-[10px] text-muted-foreground"
        )}
      >
        <span className="border-l-2 border-transparent">Asset</span>
        <span className="text-right">Balance</span>
        <span className="text-right">Price</span>
        <span className="text-right">Value</span>
        <span className="text-right">24h</span>
      </div>
      {visible.length === 0 ? (
        <Centered>
          <p className="text-[11px] text-muted-foreground">
            {rows.length === 0 ? "No tokens in this wallet" : "No balances worth $0.01 or more"}
          </p>
        </Centered>
      ) : (
        <div role="list" aria-label="Wallet balances">
          {visible.map((r) => (
            <div role="listitem" key={r.mint}>
              <BalanceRowView row={r} />
            </div>
          ))}
        </div>
      )}
      <div className="mt-auto flex flex-wrap items-center gap-x-3 gap-y-0.5 border-t border-border/50 px-3 py-1 text-[10px] text-muted-foreground">
        {total !== null && (
          <span>
            Total <span className="font-mono text-foreground/90">{formatUsdValue(total)}</span>
            {unpriced > 0 ? ` excl. ${unpriced} unpriced` : ""}
          </span>
        )}
        {hiddenCount > 0 && (
          <label className="flex cursor-pointer items-center gap-1">
            <input
              type="checkbox"
              checked={showSmall}
              onChange={(e) => setShowSmall(e.target.checked)}
              className="h-3 w-3 accent-primary"
            />
            Show small balances ({hiddenCount})
          </label>
        )}
        {notes.map((n) => (
          <span key={n} className="text-yellow-500">
            {n}
          </span>
        ))}
        <button
          type="button"
          onClick={refresh}
          disabled={holdings.isFetching}
          title="Refresh balances"
          className="ml-auto inline-flex items-center gap-1 hover:text-foreground disabled:opacity-50"
        >
          <RefreshCw className={cn("h-3 w-3", holdings.isFetching && "animate-spin")} />
          Refresh
        </button>
      </div>
    </div>
  );
}

/** Account panel under the chart: wallet balances, plus order tabs for what comes next. */
export function BottomPanel({ mint }: { mint: string }) {
  const [tab, setTab] = useState<TabId>("balances");

  return (
    <div className="flex h-full min-h-0 flex-col bg-card/30">
      <div role="tablist" aria-label="Account" className="flex shrink-0 gap-4 overflow-x-auto border-b border-border/50 px-3">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            id={`bottom-tab-${t.id}`}
            aria-selected={tab === t.id}
            aria-controls="bottom-tabpanel"
            onClick={() => setTab(t.id)}
            className={cn(
              "-mb-px whitespace-nowrap border-b py-1.5 text-[11px] font-medium transition-colors",
              tab === t.id
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            )}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div
        id="bottom-tabpanel"
        role="tabpanel"
        aria-labelledby={`bottom-tab-${tab}`}
        className="flex min-h-0 flex-1 flex-col overflow-y-auto"
      >
        {tab === "balances" ? (
          <Balances mint={mint} />
        ) : (
          <Centered>
            <p className="text-[11px] text-muted-foreground">{COMING_NEXT}</p>
          </Centered>
        )}
      </div>
    </div>
  );
}
