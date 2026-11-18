"use client";

import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import { buildHoldings } from "@/lib/markets/holdings";
import type { WalletHolding } from "@/lib/markets/types";
import {
  BALANCES_KEY,
  solBalanceQueryOptions,
  splHoldingsQueryOptions,
} from "./useTokenBalance";

/**
 * Holdings of the connected wallet: native SOL (SOL_MINT, 9 decimals) plus
 * every Token / Token-2022 mint with a non-zero balance, decimals from the
 * parsed account. Include wrapped SOL when displaying the full wallet in
 * Portfolio. All views reuse the cached RPC queries under BALANCES_KEY.
 */
export function useWalletHoldings(
  { includeWrappedSol = false }: { includeWrappedSol?: boolean } = {}
): UseQueryResult<WalletHolding[]> {
  const { connection } = useConnection();
  const { publicKey } = useWallet();
  const queryClient = useQueryClient();
  const owner = publicKey?.toBase58();

  return useQuery({
    queryKey: [BALANCES_KEY, "holdings", connection.rpcEndpoint, owner, includeWrappedSol],
    enabled: !!owner,
    queryFn: async () => {
      const [sol, spl] = await Promise.all([
        queryClient.fetchQuery(solBalanceQueryOptions(connection, owner)),
        queryClient.fetchQuery(splHoldingsQueryOptions(connection, owner)),
      ]);
      return buildHoldings(sol, spl, { includeWrappedSol });
    },
    staleTime: 15_000,
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
    retry: 1,
  });
}
