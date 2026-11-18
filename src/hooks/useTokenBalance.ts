"use client";

import { useCallback } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import BigNumber from "bignumber.js";
import { SOL_MINT } from "@/lib/constants";
import { fromBaseUnits } from "@/lib/amounts";

const TOKEN_PROGRAM_ID = new PublicKey(
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
);
const TOKEN_2022_PROGRAM_ID = new PublicKey(
  "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb"
);

/** Root query key for every balance query; invalidate it after a swap. */
export const BALANCES_KEY = "balances";

/** mint -> raw amount (base units) summed over all of the owner's accounts. */
type TokenBalanceMap = Record<string, string>;

async function fetchTokenBalances(
  connection: ReturnType<typeof useConnection>["connection"],
  owner: PublicKey
): Promise<TokenBalanceMap> {
  // One call per token program, shared by every mint we display: cheaper on a
  // rate-limited public RPC than a call per mint.
  const results = await Promise.all(
    [TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID].map((programId) =>
      connection.getParsedTokenAccountsByOwner(owner, { programId })
    )
  );
  const sums: Record<string, BigNumber> = {};
  for (const { value } of results) {
    for (const { account } of value) {
      const data = account.data;
      if (!("parsed" in data)) continue;
      const info = (data.parsed as {
        info?: { mint?: unknown; tokenAmount?: { amount?: unknown } };
      }).info;
      const mint = info?.mint;
      const amount = info?.tokenAmount?.amount;
      if (typeof mint !== "string" || typeof amount !== "string") continue;
      if (!/^\d+$/.test(amount)) continue;
      sums[mint] = (sums[mint] ?? new BigNumber(0)).plus(amount);
    }
  }
  const out: TokenBalanceMap = {};
  for (const [mint, sum] of Object.entries(sums)) out[mint] = sum.toFixed(0);
  return out;
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
  const endpoint = connection.rpcEndpoint;
  const isSol = token?.mint === SOL_MINT;

  const sol = useQuery({
    queryKey: [BALANCES_KEY, "sol", endpoint, owner],
    enabled: !!owner && isSol,
    queryFn: async () =>
      String(await connection.getBalance(new PublicKey(owner!), "confirmed")),
    staleTime: 15_000,
    refetchInterval: 60_000,
    retry: 1,
  });

  const spl = useQuery({
    queryKey: [BALANCES_KEY, "spl", endpoint, owner],
    enabled: !!owner && !!token && !isSol,
    queryFn: () => fetchTokenBalances(connection, new PublicKey(owner!)),
    staleTime: 15_000,
    refetchInterval: 60_000,
    retry: 1,
  });

  if (!owner || !token) {
    return { raw: undefined, ui: undefined, isLoading: false, isError: false };
  }
  const q = isSol ? sol : spl;
  let raw: string | undefined;
  if (isSol) raw = sol.data;
  else if (spl.data) raw = spl.data[token.mint] ?? "0";
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
