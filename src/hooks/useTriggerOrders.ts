"use client";

import { useCallback, useEffect, useMemo } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { isTriggerApiError, triggerFetch } from "@/lib/jupiter/trigger/client";
import { MANAGE_ENABLED } from "@/lib/jupiter/trigger/config";
import {
  countActiveDca,
  liveStoppedRows,
  parseHistoryPage,
  selectNeedsWithdraw,
  withStoppedRows,
} from "@/lib/jupiter/trigger/normalize";
import type {
  TriggerFamily,
  TriggerHistoryPage,
  TriggerOrderRow,
} from "@/lib/jupiter/trigger/types";
import { useTriggerSession } from "@/hooks/useTriggerAuth";
import {
  clearSettledStoppedOrders,
  recentStoppedRows,
  useTriggerBusyStore,
} from "@/store/useTriggerBusyStore";

const ACTIVE_POLL_MS = 30_000;
/** Expired price orders live under state=past but still hold funds. */
const EXPIRED_SCAN_POLL_MS = 120_000;
const ACTIVE_LIMIT = 100;

export const triggerOrderKeys = {
  all: (wallet: string) => ["trigger", wallet] as const,
  active: (wallet: string, family: TriggerFamily) => ["trigger", wallet, family, "active"] as const,
  expiredScan: (wallet: string) => ["trigger", wallet, "price", "expired-scan"] as const,
  history: (wallet: string, family: TriggerFamily, limit: number, offset: number) =>
    ["trigger", wallet, family, "past", limit, offset] as const,
};

export async function fetchTriggerPage(
  wallet: string,
  family: TriggerFamily,
  query: Record<string, string | number>,
  signal?: AbortSignal
): Promise<TriggerHistoryPage> {
  const body = await triggerFetch(family === "price" ? "orders/history" : "orders/history/dca", {
    auth: wallet,
    query,
    signal,
  });
  return parseHistoryPage(family, body);
}

function shouldRetry(failureCount: number, err: unknown): boolean {
  if (failureCount >= 2 || !isTriggerApiError(err)) return false;
  return err.code === "network" || err.code === "timeout" || err.code === "rate_limited" || err.status >= 500;
}

function retryDelay(attempt: number, err: unknown): number {
  if (isTriggerApiError(err) && err.retryAfterMs) return Math.min(err.retryAfterMs, 60_000);
  return Math.min(2_000 * 2 ** attempt, 30_000);
}

function errorText(err: unknown): string | null {
  if (!err) return null;
  if (isTriggerApiError(err) && err.code === "rate_limited") return "Rate limited by Jupiter, retrying shortly";
  return err instanceof Error ? err.message : "Could not load orders";
}

const byNewest = (a: TriggerOrderRow, b: TriggerOrderRow) =>
  b.createdAt - a.createdAt || b.updatedAt - a.updatedAt;

export interface UseTriggerOrdersResult {
  /**
   * Queries run only when signed in (status ready) and order management is
   * available (on, or new orders paused: existing orders stay manageable).
   */
  enabled: boolean;
  /** Active price + DCA orders, newest first. */
  activeRows: TriggerOrderRow[];
  priceActive: TriggerOrderRow[];
  dcaActive: TriggerOrderRow[];
  /**
   * Orders whose funds wait in the vault for a Withdraw: expired price orders
   * with funds, price pending_withdraw, DCA withdrawing. Deduped.
   */
  needsWithdraw: TriggerOrderRow[];
  /** DCA orders counting toward Jupiter's cap of 10 (withdrawing included). */
  activeDcaCount: number;
  isLoading: boolean;
  isFetching: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

/** Active orders (polled every 30 s while visible) + derived withdraw list. */
export function useTriggerOrders(): UseTriggerOrdersResult {
  const { publicKey } = useWallet();
  const wallet = publicKey?.toBase58() ?? null;
  const session = useTriggerSession(wallet);
  const enabled = MANAGE_ENABLED && !!wallet && session.status === "ready";
  const w = wallet ?? "";
  const stopped = useTriggerBusyStore((s) => s.stopped);

  const common = {
    enabled,
    retry: shouldRetry,
    retryDelay,
    staleTime: 10_000,
    // Polling pauses while the tab is hidden (refetchIntervalInBackground: false).
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
  } as const;

  const price = useQuery({
    ...common,
    queryKey: triggerOrderKeys.active(w, "price"),
    queryFn: ({ signal }) => fetchTriggerPage(w, "price", { state: "active", limit: ACTIVE_LIMIT }, signal),
    refetchInterval: ACTIVE_POLL_MS,
  });
  const dca = useQuery({
    ...common,
    queryKey: triggerOrderKeys.active(w, "dca"),
    queryFn: ({ signal }) => fetchTriggerPage(w, "dca", { state: "active", limit: ACTIVE_LIMIT }, signal),
    refetchInterval: ACTIVE_POLL_MS,
  });
  const expired = useQuery({
    ...common,
    queryKey: triggerOrderKeys.expiredScan(w),
    queryFn: ({ signal }) =>
      fetchTriggerPage(
        w,
        "price",
        { state: "past", limit: ACTIVE_LIMIT, sort: "updated_at", dir: "desc" },
        signal
      ),
    refetchInterval: EXPIRED_SCAN_POLL_MS,
  });

  const derived = useMemo(() => {
    const serverPrice = enabled ? (price.data?.rows ?? []) : [];
    const serverDca = enabled ? (dca.data?.rows ?? []) : [];
    const serverPast = enabled ? (expired.data?.rows ?? []) : [];
    // Orders stopped here whose withdrawal did not go through: shown with a
    // Withdraw button until Jupiter's lists catch up.
    const live = enabled
      ? liveStoppedRows(
          [...serverPrice, ...serverDca, ...serverPast],
          recentStoppedRows(stopped, wallet)
        )
      : [];
    const priceRows = withStoppedRows(serverPrice, live);
    const dcaRows = withStoppedRows(serverDca, live);
    const pastRows = withStoppedRows(serverPast, live);
    const activeRows = [...priceRows, ...dcaRows].sort(byNewest);
    const needsWithdraw = selectNeedsWithdraw([...activeRows, ...pastRows, ...live]);
    const activeDcaCount = Math.max(countActiveDca(dcaRows), enabled ? (dca.data?.pagination.total ?? 0) : 0);
    return { priceRows, dcaRows, activeRows, needsWithdraw, activeDcaCount };
  }, [enabled, price.data, dca.data, expired.data, stopped, wallet]);

  // Once Jupiter's lists report a locally stopped order as withdrawable or
  // finished, forget the local record for good (not just for this render), so
  // the order cannot reappear as "stopped" after it leaves the lists.
  useEffect(() => {
    if (!enabled || !wallet) return;
    clearSettledStoppedOrders(wallet, [
      ...(price.data?.rows ?? []),
      ...(dca.data?.rows ?? []),
      ...(expired.data?.rows ?? []),
    ]);
  }, [enabled, wallet, price.data, dca.data, expired.data, stopped]);

  const queryClient = useQueryClient();
  const refetch = useCallback(async () => {
    if (!wallet) return;
    await queryClient.invalidateQueries({ queryKey: triggerOrderKeys.all(wallet) });
  }, [queryClient, wallet]);

  return {
    enabled,
    activeRows: derived.activeRows,
    priceActive: derived.priceRows,
    dcaActive: derived.dcaRows,
    needsWithdraw: derived.needsWithdraw,
    activeDcaCount: derived.activeDcaCount,
    isLoading: enabled && (price.isLoading || dca.isLoading),
    isFetching: price.isFetching || dca.isFetching || expired.isFetching,
    error: errorText(price.error ?? dca.error ?? expired.error),
    refetch,
  };
}

export interface UseTriggerOrderHistoryOptions {
  family: TriggerFamily;
  /** Page size 1..100 (default 20). */
  limit?: number;
  /** Rows to skip (default 0). */
  offset?: number;
  /** Fetch only when the History tab is open (default true). */
  enabled?: boolean;
}

export interface UseTriggerOrderHistoryResult {
  rows: TriggerOrderRow[];
  /** Total rows upstream (for pagination). */
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
  isLoading: boolean;
  isFetching: boolean;
  error: string | null;
  refetch: () => void;
}

/** Past orders of one family, on demand, paginated with limit/offset. Not polled. */
export function useTriggerOrderHistory(opts: UseTriggerOrderHistoryOptions): UseTriggerOrderHistoryResult {
  const { publicKey } = useWallet();
  const wallet = publicKey?.toBase58() ?? null;
  const session = useTriggerSession(wallet);
  const limit = Math.min(100, Math.max(1, Math.floor(opts.limit ?? 20)));
  const offset = Math.max(0, Math.floor(opts.offset ?? 0));
  const enabled =
    MANAGE_ENABLED && !!wallet && session.status === "ready" && (opts.enabled ?? true);
  const w = wallet ?? "";

  const q = useQuery({
    queryKey: triggerOrderKeys.history(w, opts.family, limit, offset),
    queryFn: ({ signal }) =>
      fetchTriggerPage(
        w,
        opts.family,
        { state: "past", limit, offset, sort: "updated_at", dir: "desc" },
        signal
      ),
    enabled,
    retry: shouldRetry,
    retryDelay,
    staleTime: 30_000,
    placeholderData: keepPreviousData,
  });

  const rows = enabled ? (q.data?.rows ?? []) : [];
  const total = enabled ? (q.data?.pagination.total ?? 0) : 0;
  return {
    rows,
    total,
    limit,
    offset,
    hasMore: offset + rows.length < total,
    isLoading: enabled && q.isLoading,
    isFetching: q.isFetching,
    error: errorText(q.error),
    refetch: () => void q.refetch(),
  };
}

/** Invalidates every Trigger query of the connected wallet (after actions). */
export function useInvalidateTriggerOrders(): () => Promise<void> {
  const { publicKey } = useWallet();
  const queryClient = useQueryClient();
  const wallet = publicKey?.toBase58() ?? null;
  return useCallback(async () => {
    if (!wallet) return;
    await queryClient.invalidateQueries({ queryKey: triggerOrderKeys.all(wallet) });
  }, [queryClient, wallet]);
}
