"use client";

import { useMemo } from "react";
import Link from "next/link";
import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { RefreshCw, Wallet } from "lucide-react";
import { TokenLogo } from "@/components/swap/TokenLogo";
import { totalValueUsd, type BalanceRow } from "@/components/trade/balanceRows";
import { formatUsdPrice, formatUsdValue } from "@/components/trade/tradesFormat";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useRefreshBalances } from "@/hooks/useTokenBalance";
import { useWalletAssetRows } from "@/hooks/useWalletAssetRows";
import { useWalletHoldings } from "@/hooks/useWalletHoldings";
import { cn, shortenAddress } from "@/lib/utils";

function AssetTable({ rows }: { rows: readonly BalanceRow[] }) {
  return (
    <Table className="table-fixed text-xs sm:text-sm" aria-label="Wallet assets">
      <TableHeader className="bg-muted/30">
        <TableRow>
          <TableHead scope="col" className="w-[44%] px-3 sm:w-[40%] sm:px-5">Asset</TableHead>
          <TableHead scope="col" className="w-[28%] text-right sm:w-[20%]">Balance</TableHead>
          <TableHead scope="col" className="hidden w-[20%] text-right sm:table-cell">Price</TableHead>
          <TableHead scope="col" className="w-[28%] pr-3 text-right sm:w-[20%] sm:pr-5">Value</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <TableRow key={row.mint}>
            <TableCell className="px-3 py-3 sm:px-5">
              <Link
                href={`/trade?mint=${encodeURIComponent(row.mint)}`}
                title={row.mint}
                className="flex min-w-0 items-center gap-2 hover:text-primary focus-visible:outline-2 focus-visible:outline-ring"
              >
                <TokenLogo symbol={row.symbol} logoURI={row.logoURI} className="size-5 sm:size-7" />
                <span className="min-w-0">
                  <span className="block truncate font-medium">{row.symbol}</span>
                  {row.known && !row.isVerified && (
                    <span className="block truncate font-mono text-[10px] text-muted-foreground">
                      Unverified · {shortenAddress(row.mint)}
                    </span>
                  )}
                  {row.isVerified && row.name && row.name !== row.symbol && (
                    <span className="block truncate text-[11px] text-muted-foreground">{row.name}</span>
                  )}
                </span>
              </Link>
            </TableCell>
            <TableCell className="text-right font-mono break-all whitespace-normal tabular-nums" title={row.ui}>
              {row.balance}
            </TableCell>
            <TableCell
              className="hidden text-right font-mono break-all whitespace-normal text-muted-foreground tabular-nums sm:table-cell"
              aria-label={row.priceUsd === null ? "Price unavailable" : undefined}
            >
              {formatUsdPrice(row.priceUsd)}
            </TableCell>
            <TableCell
              className="pr-3 text-right font-mono break-all whitespace-normal tabular-nums sm:pr-5"
              aria-label={row.valueUsd === null ? "Value unavailable" : undefined}
            >
              {formatUsdValue(row.valueUsd)}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function ConnectedPortfolio() {
  const holdings = useWalletHoldings();
  const refreshBalances = useRefreshBalances();
  const assets = useMemo(() => holdings.data?.filter((holding) => holding.raw !== "0"), [holdings.data]);
  const { rows, metadata, prices } = useWalletAssetRows(assets);

  if (holdings.isPending) {
    return (
      <Card className="gap-3 border-border/50 p-5" aria-busy="true" aria-label="Loading wallet balances">
        <Skeleton className="h-6 w-36" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
      </Card>
    );
  }

  if (!holdings.data) {
    return (
      <Card className="items-center gap-3 border-border/50 px-4 py-12 text-center">
        <p role="alert" className="text-sm text-muted-foreground">Couldn’t load balances from the Solana RPC.</p>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={holdings.isFetching}
          onClick={refreshBalances}
        >
          Retry
        </Button>
      </Card>
    );
  }

  const subtotal = rows.length === 0 ? 0 : totalValueUsd(rows);
  const pricedCount = rows.filter((row) => row.valueUsd !== null).length;
  const loadingPrices = metadata.isLoading || prices.isLoading;

  function refresh() {
    refreshBalances();
    if (metadata.isError) void metadata.refetch();
    if (prices.isError || prices.stale) void prices.refetch();
  }

  return (
    <Card className="gap-0 border-border/50 py-0">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border/50 p-4 sm:p-5">
        <div>
          <h2 className="text-sm font-medium text-muted-foreground">Priced wallet subtotal</h2>
          <p className="mt-1 font-mono text-2xl font-semibold tabular-nums">
            {subtotal === null && loadingPrices ? "Loading…" : formatUsdValue(subtotal)}
          </p>
          {rows.length > 0 && !loadingPrices && (
            <p className="mt-1 text-xs text-muted-foreground">
              {pricedCount} of {rows.length} assets priced
            </p>
          )}
        </div>
        <Button type="button" size="sm" variant="outline" onClick={refresh} disabled={holdings.isFetching}>
          <RefreshCw aria-hidden className={cn(holdings.isFetching && "animate-spin")} />
          Refresh balances
        </Button>
      </div>
      {(holdings.isError || prices.stale || prices.isLoadingError) && (
        <div role="status" className="space-y-1 border-b border-border/50 px-4 py-3 text-xs text-yellow-400 sm:px-5">
          {holdings.isError && <p>Couldn’t refresh balances. Showing the last loaded amounts.</p>}
          {prices.isLoadingError
            ? <p>Prices are temporarily unavailable.</p>
            : prices.stale && <p>Some prices may be delayed or unavailable.</p>}
        </div>
      )}
      {rows.length > 0 ? (
        <AssetTable rows={rows} />
      ) : (
        <p className="px-4 py-12 text-center text-sm text-muted-foreground">No token balances in this wallet.</p>
      )}
    </Card>
  );
}

export default function PortfolioPage() {
  const { connected, connecting, publicKey } = useWallet();
  const { setVisible } = useWalletModal();
  const owner = connected ? publicKey?.toBase58() : undefined;

  return (
    <div className="mx-auto w-full max-w-5xl px-4 pt-4 pb-16 sm:pt-6">
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-gradient text-xl font-bold">Portfolio</h1>
        {owner && (
          <p className="font-mono text-xs text-muted-foreground" title={owner}>
            Wallet {shortenAddress(owner)}
          </p>
        )}
      </div>
      {owner ? (
        <ConnectedPortfolio key={owner} />
      ) : (
        <Card className="items-center gap-3 border-border/50 px-4 py-12 text-center">
          <p className="text-sm text-muted-foreground">Connect your wallet to view your Solana balances.</p>
          <Button type="button" onClick={() => setVisible(true)} disabled={connecting}>
            <Wallet aria-hidden />
            {connecting ? "Connecting…" : "Connect wallet"}
          </Button>
        </Card>
      )}
    </div>
  );
}
