"use client";

import { useCallback } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { SOL_MINT } from "@/lib/constants";
import { fromBaseUnits } from "@/lib/amounts";
import { sumTokenAccounts, type TokenHoldingMap } from "@/lib/markets/holdings";

const TOKEN_PROGRAM_ID = new PublicKey(
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
);
const TOKEN_2022_PROGRAM_ID = new PublicKey(
  "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb"
);

/** Root query key for every balance query; invalidate it after a swap. */
export const BALANCES_KEY = "balances";

type Connection = ReturnType<typeof useConnection>["connection"];

/** Every Token and Token-2022 holding of `owner`, summed per mint, with decimals. */
export async function fetchTokenHoldings(
  connection: Connection,
  owner: PublicKey
): Promise<TokenHoldingMap> {
  // One call per token program, shared by every mint we display: cheaper on a
  // rate-limited public RPC than a call per mint.
  const results = await Promise.all(
    [TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID].map((programId) =>
      connection.getParsedTokenAccountsByOwner(owner, { programId })
    )
  );
  return sumTokenAccounts(results);
}

/**
 * Query options for the owner's native SOL balance (lamports string). Shared by
 * useTokenBalance and useWalletHoldings so they reuse one cached RPC call.
 */
export function solBalanceQueryOptions(connection: Connection, owner: string | undefined) {
  return {
    queryKey: [BALANCES_KEY, "sol", connection.rpcEndpoint, owner] as const,
    queryFn: async () =>
      String(await connection.getBalance(new PublicKey(owner!), "confirmed")),
    staleTime: 15_000,
    refetchInterval: 60_000,
    retry: 1,
  };
}

/** Query options for the owner's SPL holdings (both token programs), shared likewise. */
export function splHoldingsQueryOptions(connection: Connection, owner: string | undefined) {
  return {
    queryKey: [BALANCES_KEY, "spl", connection.rpcEndpoint, owner] as const,
    queryFn: () => fetchTokenHoldings(connection, new PublicKey(owner!)),
    staleTime: 15_000,
    refetchInterval: 60_000,
    retry: 1,
  };
}

export interface TokenBalance {
  /** Raw base-unit amount, undefined while unknown. */
  raw: string | undefined;
  /** Exact UI amount string, undefined while unknown. */
  ui: string | undefined;
  isLoading: boolean;
  isError: boolean;
}

/**
 * Balance of `token` for the connected wallet. SOL uses the native balance
 * (Jupiter wraps/unwraps automatically); SPL sums Token and Token-2022 accounts.
 */
export function useTokenBalance(
  token: { mint: string; decimals: number } | null | undefined
): TokenBalance {
  const { connection } = useConnection();
  const { publicKey } = useWallet();
  const owner = publicKey?.toBase58();
  const isSol = token?.mint === SOL_MINT;

  const sol = useQuery({
    ...solBalanceQueryOptions(connection, owner),
    enabled: !!owner && isSol,
  });

  const spl = useQuery({
    ...splHoldingsQueryOptions(connection, owner),
    enabled: !!owner && !!token && !isSol,
  });

  if (!owner || !token) {
    return { raw: undefined, ui: undefined, isLoading: false, isError: false };
  }
  const q = isSol ? sol : spl;
  let raw: string | undefined;
  if (isSol) raw = sol.data;
  else if (spl.data) raw = spl.data[token.mint]?.raw ?? "0";
  return {
    raw,
    ui: raw !== undefined ? fromBaseUnits(raw, token.decimals) : undefined,
    isLoading: q.isLoading,
    isError: q.isError && raw === undefined,
  };
}

/** Returns a function that refetches every balance (call after a swap). */
export function useRefreshBalances(): () => void {
  const queryClient = useQueryClient();
  return useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: [BALANCES_KEY] });
  }, [queryClient]);
}
