"use client";

import { useCallback, useRef, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { VersionedTransaction } from "@solana/web3.js";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { base64ToBytes, bytesToBase64 } from "@/lib/jupiter/encoding";
import { isUserRejection } from "@/lib/jupiter/errors";
import {
  LANDING_TIMEOUT_MS,
  ensureVault,
  isTriggerApiError,
  triggerFetch,
} from "@/lib/jupiter/trigger/client";
import { TRIGGER_ENABLED } from "@/lib/jupiter/trigger/config";
import { countActiveDca } from "@/lib/jupiter/trigger/normalize";
import {
  buildCraftBody,
  buildCreateDcaBody,
  buildCreatePriceBody,
  extractUsdPrice,
  isDepositCacheMiss,
  isWithdrawalCacheMiss,
  parseCraftResponse,
  planDca,
  planLimitOrder,
  type DcaInput,
  type DcaPlan,
  type LimitOrderInput,
  type LimitOrderPlan,
} from "@/lib/jupiter/trigger/orders";
import type {
  TriggerCraftResponse,
  TriggerHistoryPage,
  TriggerOrderRow,
} from "@/lib/jupiter/trigger/types";
import {
  validateDepositTransaction,
  validateWithdrawalTransaction,
} from "@/lib/jupiter/trigger/validateTx";
import { getTriggerSession } from "@/store/useTriggerAuthStore";
import { triggerOrderKeys } from "@/hooks/useTriggerOrders";

export type TriggerActionErrorCode =
  /** Client-side check failed before anything was requested or signed. */
  | "validation"
  /** User rejected the wallet prompt. */
  | "rejected"
  /** Not signed in / session expired: call signIn(). */
  | "auth"
  /** The signed payload expired before Jupiter used it: press again (nothing moved). */
  | "needs_resign"
  | "rate_limited"
  /** The proxy could not confirm whether the transaction landed: check orders first. */
  | "unknown_outcome"
  /** The transaction Jupiter returned failed our safety checks; nothing was signed. */
  | "unsafe_tx"
  /** Another action is running. */
  | "busy"
  | "disabled"
  | "failed";

export type TriggerActionResult =
  | { ok: true; orderId: string; txSignature?: string }
  | { ok: false; code: TriggerActionErrorCode; error: string; retryAfterMs?: number };

export interface PlaceLimitOrderArgs extends LimitOrderInput {
  /** Current USD price of `base`; fetched from /api/market/prices when omitted. */
  currentPriceUsd?: number | null;
}

export interface PlaceDcaArgs extends DcaInput {
  currentPriceUsd?: number | null;
}

export type TriggerPendingAction =
  | { kind: "limit" }
  | { kind: "dca" }
  | { kind: "cancel"; orderId: string }
  | { kind: "withdraw"; orderId: string };

export interface UseTriggerActionsResult {
  placeLimitOrder: (args: PlaceLimitOrderArgs) => Promise<TriggerActionResult>;
  placeDca: (args: PlaceDcaArgs) => Promise<TriggerActionResult>;
  /** Stop an open order and return its funds (cancel + sign withdrawal + confirm). */
  cancelOrder: (row: TriggerOrderRow) => Promise<TriggerActionResult>;
  /** Pull funds out of an expired / half-cancelled order (same flow as cancel). */
  withdraw: (row: TriggerOrderRow) => Promise<TriggerActionResult>;
  /** The running action, or null. */
  pending: TriggerPendingAction | null;
  isBusy: boolean;
}

/** A re-crafted deposit stays usable this long (bounded by its blockhash). */
const RECRAFT_TTL_MS = 45_000;
const PRICE_TIMEOUT_MS = 6_000;

function solscanAction(signature: string | undefined) {
  if (!signature) return undefined;
  const url = `https://solscan.io/tx/${encodeURIComponent(signature)}`;
  return {
    label: "Solscan",
    onClick: () => {
      window.open(url, "_blank", "noopener,noreferrer");
    },
  };
}

async function fetchUsdPrice(mint: string): Promise<number | null> {
  try {
    const res = await fetch(`/api/market/prices?ids=${encodeURIComponent(mint)}`, {
      cache: "no-store",
      signal: AbortSignal.timeout(PRICE_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    return extractUsdPrice(await res.json(), mint);
  } catch {
    return null;
  }
}

type Stage = "prepare" | "sign" | "submit";

const fail = (
  code: TriggerActionErrorCode,
  error: string,
  retryAfterMs?: number
): TriggerActionResult => ({ ok: false, code, error, ...(retryAfterMs ? { retryAfterMs } : {}) });

/** Maps any thrown error to a typed result. `stage` decides unknown outcomes. */
function toFailure(err: unknown, stage: Stage): TriggerActionResult {
  if (isUserRejection(err)) return fail("rejected", "Cancelled in wallet");
  if (isTriggerApiError(err)) {
    if (err.code === "auth_required" || err.authError) {
      return fail("auth", "Your limit-order session expired. Sign in again");
    }
    if (err.code === "rate_limited") {
      return fail("rate_limited", "Jupiter is rate limiting requests. Try again in a few seconds", err.retryAfterMs);
    }
    if (err.unknownOutcome || (stage === "submit" && (err.code === "network" || err.code === "timeout"))) {
      return fail(
        "unknown_outcome",
        "Jupiter did not confirm the result. Check your open orders before trying again"
      );
    }
    return fail("failed", err.message);
  }
  if (err instanceof Error && err.message) return fail("failed", err.message.slice(0, 200));
  return fail("failed", "Something went wrong");
}

function deserialize(b64: string): VersionedTransaction | null {
  try {
    return VersionedTransaction.deserialize(base64ToBytes(b64));
  } catch {
    return null;
  }
}

export function useTriggerActions(): UseTriggerActionsResult {
  const { publicKey, signTransaction } = useWallet();
  const queryClient = useQueryClient();
  const [pending, setPending] = useState<TriggerPendingAction | null>(null);
  const busyRef = useRef(false);
  const recraftRef = useRef<{ key: string; craft: TriggerCraftResponse; at: number } | null>(null);
  const wallet = publicKey?.toBase58() ?? null;

  const invalidate = useCallback(() => {
    if (wallet) void queryClient.invalidateQueries({ queryKey: triggerOrderKeys.all(wallet) });
  }, [queryClient, wallet]);

  /** Shared guards; returns an error result or null when we may proceed. */
  const precheck = useCallback((): TriggerActionResult | null => {
    if (!TRIGGER_ENABLED) return fail("disabled", "Limit orders and DCA are currently unavailable");
    if (!wallet) return fail("validation", "Connect your wallet first");
    if (!signTransaction) return fail("validation", "This wallet cannot sign transactions");
    if (getTriggerSession(wallet).status !== "ready") {
      return fail("auth", "Sign in to limit orders first");
    }
    if (busyRef.current) return fail("busy", "Another order action is still running");
    return null;
  }, [wallet, signTransaction]);

  const resolvePrice = useCallback(
    async (mint: string, given: number | null | undefined, fallback: number | undefined) => {
      if (typeof given === "number" && Number.isFinite(given) && given > 0) return given;
      const fetched = await fetchUsdPrice(mint);
      if (fetched !== null) return fetched;
      return typeof fallback === "number" && Number.isFinite(fallback) && fallback > 0 ? fallback : null;
    },
    []
  );

  /** craft -> validate -> sign -> create, shared by limit and DCA. */
  const submitOrder = useCallback(
    async (
      plan: LimitOrderPlan | DcaPlan,
      label: string
    ): Promise<TriggerActionResult> => {
      const user = wallet!;
      const sign = signTransaction!;
      let stage: Stage = "prepare";
      const toastId = toast.loading(`Preparing ${label}...`);
      try {
        const vault = await ensureVault(user);
        const craftBody = buildCraftBody(plan, user);
        const key = JSON.stringify(craftBody);
        const cached = recraftRef.current;
        recraftRef.current = null;
        let craft: TriggerCraftResponse;
        if (cached && cached.key === key && Date.now() - cached.at < RECRAFT_TTL_MS) {
          craft = cached.craft;
        } else {
          const body = await triggerFetch("deposit/craft", { method: "POST", body: craftBody, auth: user });
          const parsed = parseCraftResponse(body, plan);
          if (!parsed.ok) {
            toast.error(parsed.error, { id: toastId });
            return fail("failed", parsed.error);
          }
          craft = parsed.craft;
        }

        const tx = deserialize(craft.transaction);
        if (!tx) {
          toast.error("Could not read Jupiter's deposit transaction. Nothing was signed", { id: toastId });
          return fail("unsafe_tx", "Could not read Jupiter's deposit transaction");
        }
        const check = validateDepositTransaction(tx, {
          user,
          inputMint: plan.inputMint,
          outputMint: plan.outputMint,
          amount: plan.amount,
          receiverAddress: craft.receiverAddress,
          inputTokenAccount: craft.inputTokenAccount,
          vaultPubkey: vault.vaultPubkey,
          tokenDecimals: craft.tokenDecimals,
        });
        if (!check.ok) {
          const error = `Safety check failed, nothing was signed: ${check.reason}`;
          toast.error(error, { id: toastId, duration: 15_000 });
          return fail("unsafe_tx", error);
        }

        stage = "sign";
        toast.loading("Approve the deposit in your wallet...", { id: toastId });
        const signed = await sign(tx);
        const depositSignedTx = bytesToBase64(signed.serialize());

        stage = "submit";
        toast.loading(`Placing ${label}...`, { id: toastId });
        let created: unknown;
        try {
          created =
            plan.kind === "limit"
              ? await triggerFetch("orders/price", {
                  method: "POST",
                  auth: user,
                  timeoutMs: LANDING_TIMEOUT_MS,
                  body: buildCreatePriceBody(plan, user, craft.requestId, depositSignedTx),
                })
              : await triggerFetch("orders/dca", {
                  method: "POST",
                  auth: user,
                  timeoutMs: LANDING_TIMEOUT_MS,
                  body: buildCreateDcaBody(plan, user, craft.requestId, depositSignedTx),
                });
        } catch (err) {
          if (isTriggerApiError(err) && isDepositCacheMiss(err.message)) {
            // Re-craft once so the next press is quick, but never re-sign on
            // the user's behalf: they must press again and approve.
            try {
              const body = await triggerFetch("deposit/craft", { method: "POST", body: craftBody, auth: user });
              const parsed = parseCraftResponse(body, plan);
              if (parsed.ok) recraftRef.current = { key, craft: parsed.craft, at: Date.now() };
            } catch {
              // The next press crafts from scratch.
            }
            const error =
              "The deposit expired before Jupiter received it. Nothing left your wallet. Press the button again to approve a fresh one";
            toast.warning(error, { id: toastId, duration: 10_000 });
            return fail("needs_resign", error);
          }
          throw err;
        }

        const c = (created ?? {}) as { id?: unknown; txSignature?: unknown };
        const orderId = typeof c.id === "string" ? c.id : "";
        const txSignature = typeof c.txSignature === "string" ? c.txSignature : undefined;
        toast.success(`${label[0].toUpperCase()}${label.slice(1)} placed`, {
          id: toastId,
          action: solscanAction(txSignature),
          duration: 10_000,
        });
        return { ok: true, orderId, txSignature };
      } catch (err) {
        const result = toFailure(err, stage);
        if (!result.ok) {
          if (result.code === "rejected") toast.dismiss(toastId);
          else if (result.code === "unknown_outcome") toast.warning(result.error, { id: toastId, duration: 15_000 });
          else toast.error(result.error, { id: toastId });
        }
        return result;
      }
    },
    [wallet, signTransaction]
  );

  const run = useCallback(
    async (action: TriggerPendingAction, body: () => Promise<TriggerActionResult>) => {
      busyRef.current = true;
      setPending(action);
      try {
        return await body();
      } finally {
        busyRef.current = false;
        setPending(null);
        invalidate();
      }
    },
    [invalidate]
  );

  const placeLimitOrder = useCallback(
    async (args: PlaceLimitOrderArgs): Promise<TriggerActionResult> => {
      const blocked = precheck();
      if (blocked) return blocked;
      return run({ kind: "limit" }, async () => {
        const price = await resolvePrice(args.base.mint, args.currentPriceUsd, args.base.usdPrice);
        const planned = planLimitOrder(args, { basePriceUsd: price, nowMs: Date.now() });
        // Not toasted: the form shows validation errors inline.
        if (!planned.ok) return fail("validation", planned.error);
        return submitOrder(planned.plan, "limit order");
      });
    },
    [precheck, run, resolvePrice, submitOrder]
  );

  const placeDca = useCallback(
    async (args: PlaceDcaArgs): Promise<TriggerActionResult> => {
      const blocked = precheck();
      if (blocked) return blocked;
      return run({ kind: "dca" }, async () => {
        const price =
          args.side === "sell"
            ? await resolvePrice(args.base.mint, args.currentPriceUsd, args.base.usdPrice)
            : (args.currentPriceUsd ?? args.base.usdPrice ?? null);
        const page = wallet
          ? queryClient.getQueryData<TriggerHistoryPage>(triggerOrderKeys.active(wallet, "dca"))
          : undefined;
        const activeDcaCount = page
          ? Math.max(countActiveDca(page.rows), page.pagination.total)
          : null;
        const planned = planDca(args, { basePriceUsd: price, nowMs: Date.now(), activeDcaCount });
        // Not toasted: the form shows validation errors inline.
        if (!planned.ok) return fail("validation", planned.error);
        return submitOrder(planned.plan, "DCA order");
      });
    },
    [precheck, run, resolvePrice, submitOrder, queryClient, wallet]
  );

  /** cancel step 1 -> validate withdrawal -> sign -> confirm-cancel. */
  const cancelOrWithdraw = useCallback(
    async (row: TriggerOrderRow, mode: "cancel" | "withdraw"): Promise<TriggerActionResult> => {
      const blocked = precheck();
      if (blocked) return blocked;
      if (mode === "cancel" ? !row.canCancel : !row.canWithdraw) {
        return fail(
          "validation",
          mode === "cancel" ? "This order cannot be cancelled right now" : "Nothing to withdraw from this order"
        );
      }
      const user = wallet!;
      const sign = signTransaction!;
      return run({ kind: mode, orderId: row.id }, async () => {
        let stage: Stage = "prepare";
        let stopped = false;
        const toastId = toast.loading(mode === "cancel" ? "Cancelling order..." : "Preparing withdrawal...");
        try {
          const res = (await triggerFetch(`orders/${row.family}/cancel/${row.id}`, {
            method: "POST",
            auth: user,
          })) as { transaction?: unknown; requestId?: unknown } | null;
          // From here the order no longer fills; funds wait for the withdrawal.
          stopped = true;
          const b64 = typeof res?.transaction === "string" ? res.transaction : "";
          const cancelRequestId = typeof res?.requestId === "string" ? res.requestId : "";
          const tx = b64 ? deserialize(b64) : null;
          if (!tx || !cancelRequestId) {
            const error = "Jupiter returned an unreadable withdrawal. Nothing was signed; try Withdraw again";
            toast.error(error, { id: toastId });
            return fail("failed", error);
          }
          const check = validateWithdrawalTransaction(tx, { user, mints: [row.inputMint, row.outputMint] });
          if (!check.ok) {
            const error = `Safety check failed, nothing was signed: ${check.reason}. The order is stopped and its funds stay in the Jupiter vault`;
            toast.error(error, { id: toastId, duration: 15_000 });
            return fail("unsafe_tx", error);
          }

          stage = "sign";
          toast.loading("Approve the withdrawal in your wallet...", { id: toastId });
          const signed = await sign(tx);

          stage = "submit";
          toast.loading("Withdrawing...", { id: toastId });
          let confirmed: unknown;
          try {
            confirmed = await triggerFetch(`orders/${row.family}/confirm-cancel/${row.id}`, {
              method: "POST",
              auth: user,
              timeoutMs: LANDING_TIMEOUT_MS,
              body: { signedTransaction: bytesToBase64(signed.serialize()), cancelRequestId },
            });
          } catch (err) {
            if (isTriggerApiError(err) && isWithdrawalCacheMiss(err.message)) {
              const error =
                "The withdrawal expired before Jupiter received it. Your funds are safe in the vault: press Withdraw again";
              toast.warning(error, { id: toastId, duration: 10_000 });
              return fail("needs_resign", error);
            }
            throw err;
          }
          const c = (confirmed ?? {}) as { id?: unknown; txSignature?: unknown };
          const txSignature = typeof c.txSignature === "string" ? c.txSignature : undefined;
          toast.success(mode === "cancel" ? "Order cancelled, funds returned" : "Funds withdrawn", {
            id: toastId,
            action: solscanAction(txSignature),
            duration: 10_000,
          });
          return { ok: true, orderId: typeof c.id === "string" ? c.id : row.id, txSignature };
        } catch (err) {
          const result = toFailure(err, stage);
          if (!result.ok) {
            if (result.code === "rejected" && stopped) {
              const error =
                "Order stopped, but its funds are still in the Jupiter vault. Press Withdraw to get them back";
              toast.warning(error, { id: toastId, duration: 12_000 });
              return fail("rejected", error);
            }
            if (result.code === "rejected") toast.dismiss(toastId);
            else if (result.code === "unknown_outcome") toast.warning(result.error, { id: toastId, duration: 15_000 });
            else toast.error(result.error, { id: toastId });
          }
          return result;
        }
      });
    },
    [precheck, run, wallet, signTransaction]
  );

  const cancelOrder = useCallback((row: TriggerOrderRow) => cancelOrWithdraw(row, "cancel"), [cancelOrWithdraw]);
  const withdraw = useCallback((row: TriggerOrderRow) => cancelOrWithdraw(row, "withdraw"), [cancelOrWithdraw]);

  return { placeLimitOrder, placeDca, cancelOrder, withdraw, pending, isBusy: pending !== null };
}
