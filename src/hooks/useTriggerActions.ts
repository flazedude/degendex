"use client";

import { useCallback, useRef } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { VersionedTransaction } from "@solana/web3.js";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { USDC_MINT } from "@/lib/constants";
import { base64ToBytes, bytesToBase64 } from "@/lib/jupiter/encoding";
import {
  PRICE_DELAYED_MESSAGE,
  STOPPED_NOT_WITHDRAWN_MESSAGE,
  UNKNOWN_ORDER_HOLD_MESSAGE,
  UNKNOWN_OUTCOME_MESSAGE,
  UNREADABLE_WITHDRAWAL_MESSAGE,
  disabledReason,
  fail,
  isDefiniteCancelRejection,
  toFailure,
  withdrawalCheckFailedMessage,
  type TriggerActionResult,
  type TriggerActionStage,
} from "@/lib/jupiter/trigger/actionResult";
import {
  LANDING_TIMEOUT_MS,
  ensureVault,
  isTriggerApiError,
  triggerFetch,
} from "@/lib/jupiter/trigger/client";
import { JUPITER_APP_URL, TRIGGER_MODE } from "@/lib/jupiter/trigger/config";
import { countActiveDca } from "@/lib/jupiter/trigger/normalize";
import {
  buildCraftBody,
  buildCreateDcaBody,
  buildCreatePriceBody,
  isDepositCacheMiss,
  isWithdrawalCacheMiss,
  parseCraftResponse,
  planDca,
  planLimitOrder,
  readUsdPrice,
  type DcaInput,
  type DcaPlan,
  type LimitOrderInput,
  type LimitOrderPlan,
  type PriceRead,
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
import {
  acquireTriggerBusy,
  busyReason,
  clearStoppedOrder,
  getActiveTriggerPending,
  holdNewOrders,
  isNewOrderHeld,
  markOrderStopped,
  releaseTriggerBusy,
  useActiveTriggerPending,
  useTriggerBusyStore,
  type TriggerPendingAction,
} from "@/store/useTriggerBusyStore";
import { triggerOrderKeys } from "@/hooks/useTriggerOrders";

export type {
  TriggerActionErrorCode,
  TriggerActionResult,
} from "@/lib/jupiter/trigger/actionResult";
export type { TriggerPendingAction } from "@/store/useTriggerBusyStore";

export interface PlaceLimitOrderArgs extends LimitOrderInput {
  /**
   * Current, non-delayed USD price of `base`; fetched from
   * /api/market/prices when omitted (a delayed answer there is refused).
   */
  currentPriceUsd?: number | null;
  /** Live USD price of USDC for the $10 minimum on buys; fetched when omitted. */
  usdcPriceUsd?: number | null;
}

export interface PlaceDcaArgs extends DcaInput {
  currentPriceUsd?: number | null;
}

export interface UseTriggerActionsResult {
  placeLimitOrder: (args: PlaceLimitOrderArgs) => Promise<TriggerActionResult>;
  placeDca: (args: PlaceDcaArgs) => Promise<TriggerActionResult>;
  /** Stop an open order and return its funds (cancel + sign withdrawal + confirm). */
  cancelOrder: (row: TriggerOrderRow) => Promise<TriggerActionResult>;
  /** Pull funds out of an expired / half-cancelled order (same flow as cancel). */
  withdraw: (row: TriggerOrderRow) => Promise<TriggerActionResult>;
  /** The running action (shared by every instance of this hook), or null. */
  pending: TriggerPendingAction | null;
  /** Some Trigger action is running anywhere in the app. */
  isBusy: boolean;
  /** Short reason another action cannot start now, or null. */
  busyReason: string | null;
  /** New orders are on hold after an order whose outcome is unknown. */
  newOrdersHeld: boolean;
}

/** A re-crafted deposit stays usable this long (bounded by its blockhash). */
const RECRAFT_TTL_MS = 45_000;
const PRICE_TIMEOUT_MS = 6_000;
/** After an unknown outcome, refetch the orders again after these delays. */
const UNKNOWN_REFETCH_DELAYS_MS = [20_000, 65_000];

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

const jupiterAction = {
  label: "jup.ag",
  onClick: () => {
    window.open(JUPITER_APP_URL, "_blank", "noopener,noreferrer");
  },
};

async function fetchPriceRead(mint: string): Promise<PriceRead> {
  try {
    const res = await fetch(`/api/market/prices?ids=${encodeURIComponent(mint)}`, {
      cache: "no-store",
      signal: AbortSignal.timeout(PRICE_TIMEOUT_MS),
    });
    if (!res.ok) return { kind: "missing" };
    return readUsdPrice(await res.json(), mint, Date.now());
  } catch {
    return { kind: "missing" };
  }
}

const positive = (v: number | null | undefined): v is number =>
  typeof v === "number" && Number.isFinite(v) && v > 0;

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
  // Null once a lock lapses (TRIGGER_BUSY_MAX_MS), so the buttons come back.
  const pending = useActiveTriggerPending();
  const holdUntil = useTriggerBusyStore((s) => s.holdUntil);
  const recraftRef = useRef<{ key: string; craft: TriggerCraftResponse; at: number } | null>(null);
  const wallet = publicKey?.toBase58() ?? null;

  const invalidate = useCallback(() => {
    if (wallet) void queryClient.invalidateQueries({ queryKey: triggerOrderKeys.all(wallet) });
  }, [queryClient, wallet]);

  /** The outcome is unknown: look again once Jupiter has had time to settle. */
  const scheduleRefetch = useCallback(() => {
    if (!wallet) return;
    for (const ms of UNKNOWN_REFETCH_DELAYS_MS) {
      setTimeout(() => void queryClient.invalidateQueries({ queryKey: triggerOrderKeys.all(wallet) }), ms);
    }
  }, [queryClient, wallet]);

  /** Shared guards; returns an error result or null when we may proceed. */
  const precheck = useCallback(
    (action: "new-order" | "manage"): TriggerActionResult | null => {
      const disabled = disabledReason(TRIGGER_MODE, action);
      if (disabled) return fail("disabled", disabled);
      if (!wallet) return fail("validation", "Connect your wallet first");
      if (!signTransaction) return fail("validation", "This wallet cannot sign transactions");
      if (getTriggerSession(wallet).status !== "ready") {
        return fail("auth", "Sign in to limit orders first");
      }
      const reason = busyReason(getActiveTriggerPending());
      if (reason) return fail("busy", reason);
      if (action === "new-order" && isNewOrderHeld()) return fail("busy", UNKNOWN_ORDER_HOLD_MESSAGE);
      return null;
    },
    [wallet, signTransaction]
  );

  /** craft -> validate -> sign -> create, shared by limit and DCA. */
  const submitOrder = useCallback(
    async (
      plan: LimitOrderPlan | DcaPlan,
      label: string
    ): Promise<TriggerActionResult> => {
      const user = wallet!;
      const sign = signTransaction!;
      let stage: TriggerActionStage = "prepare";
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
        if (!orderId) {
          // A 2xx without an order id (or not JSON at all): cannot confirm.
          holdNewOrders();
          scheduleRefetch();
          toast.warning(UNKNOWN_OUTCOME_MESSAGE, { id: toastId, duration: 20_000 });
          return fail("unknown_outcome", UNKNOWN_OUTCOME_MESSAGE);
        }
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
          else if (result.code === "unknown_outcome") {
            // Never invite an immediate retry: a second press could deposit
            // twice. Hold new orders briefly and look again.
            holdNewOrders();
            scheduleRefetch();
            toast.warning(result.error, { id: toastId, duration: 20_000 });
          } else toast.error(result.error, { id: toastId });
        }
        return result;
      }
    },
    [wallet, signTransaction, scheduleRefetch]
  );

  const run = useCallback(
    async (action: TriggerPendingAction, body: () => Promise<TriggerActionResult>) => {
      const token = acquireTriggerBusy(action);
      if (token === null) {
        return fail("busy", busyReason(getActiveTriggerPending()) ?? "Another order action is running");
      }
      try {
        return await body();
      } finally {
        releaseTriggerBusy(token);
        invalidate();
      }
    },
    [invalidate]
  );

  const placeLimitOrder = useCallback(
    async (args: PlaceLimitOrderArgs): Promise<TriggerActionResult> => {
      const blocked = precheck("new-order");
      if (blocked) return blocked;
      return run({ kind: "limit" }, async () => {
        // The side-of-market check needs a live price: a delayed one is
        // refused, and the token list's price is never used for it.
        let price: number | null = positive(args.currentPriceUsd) ? args.currentPriceUsd : null;
        if (price === null) {
          const read = await fetchPriceRead(args.base.mint);
          if (read.kind === "stale") return fail("validation", PRICE_DELAYED_MESSAGE);
          if (read.kind === "fresh") price = read.price;
        }
        // Jupiter values the deposit at its own USDC price; falls back to $1.
        let usdcPrice: number | null = null;
        if (args.side === "buy") {
          if (positive(args.usdcPriceUsd)) usdcPrice = args.usdcPriceUsd;
          else {
            const read = await fetchPriceRead(USDC_MINT);
            usdcPrice = read.kind === "missing" ? null : read.price;
          }
        }
        const planned = planLimitOrder(args, { basePriceUsd: price, usdcPriceUsd: usdcPrice, nowMs: Date.now() });
        // Not toasted: the form shows validation errors inline.
        if (!planned.ok) return fail("validation", planned.error);
        return submitOrder(planned.plan, "limit order");
      });
    },
    [precheck, run, submitOrder]
  );

  const placeDca = useCallback(
    async (args: PlaceDcaArgs): Promise<TriggerActionResult> => {
      const blocked = precheck("new-order");
      if (blocked) return blocked;
      return run({ kind: "dca" }, async () => {
        // Only feeds the $10-per-round minimum (Jupiter allows $0.20 of
        // tolerance there), so a delayed price or the token list's is fine.
        let price: number | null = positive(args.currentPriceUsd) ? args.currentPriceUsd : null;
        if (price === null && args.side === "sell") {
          const read = await fetchPriceRead(args.base.mint);
          if (read.kind !== "missing") price = read.price;
        }
        if (price === null && positive(args.base.usdPrice)) price = args.base.usdPrice;
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
    [precheck, run, submitOrder, queryClient, wallet]
  );

  /** cancel step 1 -> validate withdrawal -> sign -> confirm-cancel. */
  const cancelOrWithdraw = useCallback(
    async (row: TriggerOrderRow, mode: "cancel" | "withdraw"): Promise<TriggerActionResult> => {
      const blocked = precheck("manage");
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
        let stage: TriggerActionStage = "prepare";
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
            markOrderStopped(user, row);
            toast.error(UNREADABLE_WITHDRAWAL_MESSAGE, { id: toastId, duration: 20_000, action: jupiterAction });
            return fail("failed", UNREADABLE_WITHDRAWAL_MESSAGE);
          }
          const check = validateWithdrawalTransaction(tx, { user, mints: [row.inputMint, row.outputMint] });
          if (!check.ok) {
            // The order is already cancelled: keep it listed with a Withdraw
            // button (a fresh cancel call returns a fresh withdrawal) and point
            // to jup.ag, which manages the same vault.
            markOrderStopped(user, row);
            const error = withdrawalCheckFailedMessage(check.reason);
            toast.error(error, { id: toastId, duration: 30_000, action: jupiterAction });
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
              markOrderStopped(user, row);
              const error =
                "The withdrawal expired before Jupiter received it. Your funds are safe in the vault: press Withdraw again";
              toast.warning(error, { id: toastId, duration: 10_000 });
              return fail("needs_resign", error);
            }
            throw err;
          }
          const c = (confirmed ?? {}) as { id?: unknown; txSignature?: unknown };
          const txSignature = typeof c.txSignature === "string" ? c.txSignature : undefined;
          clearStoppedOrder(user, row);
          toast.success(mode === "cancel" ? "Order cancelled, funds returned" : "Funds withdrawn", {
            id: toastId,
            action: solscanAction(txSignature),
            duration: 10_000,
          });
          return { ok: true, orderId: typeof c.id === "string" ? c.id : row.id, txSignature };
        } catch (err) {
          // Jupiter refused the cancel step outright (e.g. already withdrawn
          // elsewhere): a local "stopped" record of this order is stale.
          if (!stopped && mode === "withdraw" && isDefiniteCancelRejection(err)) clearStoppedOrder(user, row);
          const result = toFailure(err, stage);
          if (!result.ok) {
            if (result.code === "unknown_outcome") {
              // The withdrawal may have landed: do not offer it again yet.
              scheduleRefetch();
              toast.warning(result.error, { id: toastId, duration: 20_000 });
              return result;
            }
            if (stopped) markOrderStopped(user, row);
            if (result.code === "rejected" && stopped) {
              toast.warning(STOPPED_NOT_WITHDRAWN_MESSAGE, { id: toastId, duration: 12_000 });
              return fail("rejected", STOPPED_NOT_WITHDRAWN_MESSAGE);
            }
            if (result.code === "rejected") toast.dismiss(toastId);
            else toast.error(result.error, { id: toastId });
          }
          return result;
        }
      });
    },
    [precheck, run, wallet, signTransaction, scheduleRefetch]
  );

  const cancelOrder = useCallback((row: TriggerOrderRow) => cancelOrWithdraw(row, "cancel"), [cancelOrWithdraw]);
  const withdraw = useCallback((row: TriggerOrderRow) => cancelOrWithdraw(row, "withdraw"), [cancelOrWithdraw]);

  return {
    placeLimitOrder,
    placeDca,
    cancelOrder,
    withdraw,
    pending,
    isBusy: pending !== null,
    busyReason: busyReason(pending),
    // Re-rendered when the store clears holdUntil (timer in holdNewOrders).
    newOrdersHeld: holdUntil > 0,
  };
}
