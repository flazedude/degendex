"use client";

import { useEffect } from "react";
import { useConnection } from "@solana/wallet-adapter-react";
import type { Connection, SignatureStatus } from "@solana/web3.js";
import { toast } from "sonner";
import { useRefreshBalances } from "@/hooks/useTokenBalance";
import { swapExplorerAction } from "@/lib/swapReceipts";
import { usePendingSwapStore, type PendingSwap } from "@/store/usePendingSwapStore";
import { recordConfirmedSwap } from "@/store/useSwapReceipts";

const STATUS_POLL_MS = 2_000;
const RPC_TIMEOUT_MS = 8_000;

export function monitorPendingSwap(
  pending: PendingSwap,
  connection: Pick<Connection, "getSignatureStatuses" | "getBlockHeight">,
  refreshBalances: () => void
): () => void {
  const { wallet, signature, until, lastValidBlockHeight, summary, toastId, tokens } = pending;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let cancelRpc: (() => void) | undefined;
  let stopped = false;
  let expired = false;

  function stop() {
    stopped = true;
    clearTimeout(timer);
    cancelRpc?.();
  }

  function isCurrent() {
    return !stopped && usePendingSwapStore.getState().pending[wallet] === pending;
  }

  function finish() {
    stop();
    usePendingSwapStore.getState().clearPending(pending);
    refreshBalances();
  }

  const opts = { id: toastId, action: swapExplorerAction(signature), duration: 10_000 };

  function readRpc<T>(promise: Promise<T>): Promise<T> {
    let rpcTimer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      cancelRpc = () => reject(new Error("RPC monitor stopped"));
      rpcTimer = setTimeout(() => reject(new Error("RPC timeout")), RPC_TIMEOUT_MS);
    });
    return Promise.race([promise, timeout]).finally(() => {
      clearTimeout(rpcTimer);
      cancelRpc = undefined;
    });
  }

  function schedulePoll(txSignature: string) {
    if (isCurrent()) timer = setTimeout(() => void poll(txSignature), STATUS_POLL_MS);
  }

  async function poll(txSignature: string) {
    if (!isCurrent()) return;
    let status: SignatureStatus | null | undefined;
    try {
      const { value } = await readRpc(
        connection.getSignatureStatuses([txSignature], { searchTransactionHistory: true })
      );
      status = value[0] ?? null;
    } catch {
      // RPC hiccup: keep polling until the deadline.
    }
    if (!isCurrent()) return;

    if (status?.err) {
      toast.error("Swap failed on chain", opts);
      finish();
      return;
    }
    if (status?.confirmationStatus === "confirmed" || status?.confirmationStatus === "finalized") {
      toast.success(`Swap confirmed: ${summary}`, opts);
      finish();
      if (tokens) {
        recordConfirmedSwap({
          wallet,
          signature: txSignature,
          confirmedAt: Date.now(),
          ...tokens,
          inputAmountRaw: null,
          outputAmountRaw: null,
        });
      }
      return;
    }

    // Only a successful lookup after expiry proves it can no longer land.
    if (expired && status === null) {
      toast.error("Swap did not land (transaction expired). You can swap again", opts);
      finish();
      return;
    }
    if (Date.now() >= until) {
      toast.error("Swap not confirmed after 90s. Check your wallet activity before retrying", opts);
      finish();
      return;
    }
    if (lastValidBlockHeight !== undefined && !expired) {
      try {
        const height = await readRpc(connection.getBlockHeight("confirmed"));
        expired = height > lastValidBlockHeight;
      } catch {
        // Retry the height check on the next poll.
      }
    }
    schedulePoll(txSignature);
  }

  const remaining = until - Date.now();
  if (!isCurrent()) return stop;
  if (remaining <= 0) {
    usePendingSwapStore.getState().clearPending(pending);
  } else if (signature) {
    schedulePoll(signature);
  } else {
    timer = setTimeout(() => {
      if (!isCurrent()) return;
      toast("Previous swap window has passed. Check your wallet activity before swapping again", opts);
      finish();
    }, remaining);
  }
  return stop;
}

function PendingSwapWatcher({ pending }: { pending: PendingSwap }) {
  const { connection } = useConnection();
  const refreshBalances = useRefreshBalances();
  useEffect(
    () => monitorPendingSwap(pending, connection, refreshBalances),
    [pending, connection, refreshBalances]
  );
  return null;
}

/** Keeps watching pending swaps across client-side navigation. */
export function PendingSwapMonitor() {
  const pending = usePendingSwapStore((state) => state.pending);
  return Object.values(pending).map((record) => (
    <PendingSwapWatcher key={record.wallet} pending={record} />
  ));
}
