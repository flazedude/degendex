"use client";

import { useMemo } from "react";
import { buildBalanceRows } from "@/components/trade/balanceRows";
import type { WalletHolding } from "@/lib/markets/types";
import { useTokenMetadata } from "./useTokenMetadata";
import { useTokenPrices } from "./useTokenPrices";

const EMPTY_HOLDINGS: readonly WalletHolding[] = [];

export function useWalletAssetRows(
  holdings: readonly WalletHolding[] = EMPTY_HOLDINGS,
  currentMint: string | null = null
) {
  const mints = useMemo(() => holdings.map((holding) => holding.mint), [holdings]);
  const metadata = useTokenMetadata(mints);
  const priceMints = useMemo(() => {
    if (metadata.data) return mints.filter((mint) => metadata.data[mint]);
    if (!metadata.isError) return [];
    // On a metadata outage, keep looking up fungible holdings while skipping NFT-like airdrops.
    return holdings
      .filter((holding) => holding.decimals > 0)
      .map((holding) => holding.mint);
  }, [holdings, metadata.data, metadata.isError, mints]);
  const prices = useTokenPrices(priceMints);
  const rows = useMemo(
    () => buildBalanceRows(holdings, metadata.data, prices.data, currentMint),
    [holdings, metadata.data, prices.data, currentMint]
  );

  return { rows, metadata, prices };
}
