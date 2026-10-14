"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { VersionedTransaction, type PublicKey } from "@solana/web3.js";
import BigNumber from "bignumber.js";
import { toast } from "sonner";
import { useSwapStore, type TokenInfo } from "@/store/useSwapStore";
import { useSettingsStore, type SlippageSetting } from "@/store/useSettingsStore";
import {
  isSwapBlocked,
  usePendingSwapStore,
  type PendingSwap,
} from "@/store/usePendingSwapStore";
import { useRefreshBalances } from "@/hooks/useTokenBalance";
import { formatTokenAmount, fromBaseUnits, toBaseUnits } from "@/lib/amounts";
import { base64ToBytes, bytesToBase58, bytesToBase64 } from "@/lib/jupiter/encoding";
import {
  EXECUTE_UNKNOWN_STATUS_CODE,
  describeExecuteError,
  describeOrderError,
  isUnknownExecuteOutcome,
  isUserRejection,
} from "@/lib/jupiter/errors";
import { checkRequote } from "@/lib/jupiter/requote";
import {
  getImpactSeverity,
  getPriceImpactPercent,
} from "@/lib/jupiter/priceImpact";
import type { JupiterExecuteResult, JupiterOrder } from "@/lib/jupiter/types";

const QUOTE_DEBOUNCE_MS = 400;
const QUOTE_REFRESH_MS = 20_000;
/** Orders older than this are re-fetched before signing. */
const MAX_ORDER_AGE_MS = 15_000;
/** RFQ orders expiring sooner than this are re-fetched before signing. */
const RFQ_MIN_REMAINING_MS = 5_000;
const STALE_AFTER_MS = 25_000;
const EXECUTE_CLIENT_TIMEOUT_MS = 75_000;
/** Backoff after a 429 / network error when the server gives no hint. */
const DEFAULT_RETRY_AFTER_MS = 2_000;
const MAX_RETRY_AFTER_MS = 60_000;
const RETRY_JITTER_MS = 1_000;
/** How long an unknown /execute outcome blocks new swaps (tx validity window). */
const PENDING_MAX_MS = 90_000;
const STATUS_POLL_MS = 2_000;
const RPC_TIMEOUT_MS = 8_000;

export interface QuoteRequest {
  key: string;
  inputMint: string;
  outputMint: string;
  amount: string;
  taker?: string;
  slippageBps?: number;
}

interface QuoteResult {
  key: string;
  order: JupiterOrder | null;
  error: string | null;
  fetchedAt: number;
  /** A refresh failed transiently; the order shown is kept but is not current. */
  stale?: boolean;
}

/** Quote failure carrying the HTTP status and the server's backoff hint. */
class QuoteError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly retryAfterMs?: number
  ) {
    super(message);
    this.name = "QuoteError";
  }
}

const DIGITS = /^\d+$/;

function errorText(body: unknown): string | null {
  if (body && typeof body === "object" && "error" in body) {
    const e = (body as { error: unknown }).error;
    if (typeof e === "string" && e) return e;
  }
  return null;
}

async function fetchOrder(
  req: QuoteRequest,
  signal?: AbortSignal
): Promise<JupiterOrder> {
  const qs = new URLSearchParams({
    inputMint: req.inputMint,
    outputMint: req.outputMint,
    amount: req.amount,
  });
  if (req.taker) qs.set("taker", req.taker);
  if (req.slippageBps !== undefined) qs.set("slippageBps", String(req.slippageBps));

  const res = await fetch(`/api/jupiter/order?${qs}`, {
    signal: signal ?? AbortSignal.timeout(20_000),
    cache: "no-store",
  });
  const body: unknown = await res.json().catch(() => null);
  if (!res.ok || !body || typeof body !== "object") {
    let retryAfterMs: number | undefined;
    if (res.status === 429) {
      const hinted =
        body && typeof body === "object" && "retryAfterMs" in body
          ? Number((body as { retryAfterMs: unknown }).retryAfterMs)
          : Number(res.headers.get("retry-after")) * 1000;
      retryAfterMs = Number.isFinite(hinted) && hinted > 0 ? hinted : undefined;
    }
    throw new QuoteError(
      errorText(body) ?? `Quote failed (${res.status})`,
      res.status,
      retryAfterMs
    );
  }
  const o = body as JupiterOrder;
  // Never trust a quote that does not describe exactly what was asked for.
  if (
    typeof o.requestId !== "string" ||
    typeof o.inAmount !== "string" ||
    typeof o.outAmount !== "string" ||
    typeof o.otherAmountThreshold !== "string" ||
    !DIGITS.test(o.inAmount) ||
    !DIGITS.test(o.outAmount) ||
    !DIGITS.test(o.otherAmountThreshold) ||
    o.inputMint !== req.inputMint ||
    o.outputMint !== req.outputMint ||
    new BigNumber(o.inAmount).gt(req.amount) ||
    (req.taker && o.taker && o.taker !== req.taker)
  ) {
    if (errorText(o)) throw new Error(errorText(o)!);
    throw new Error("Unexpected quote from Jupiter");
  }
  return o;
}

function quoteErrorMessage(err: unknown): string {
  const msg = err instanceof Error ? err.message : "";
  if (/route/i.test(msg)) return "No route found";
  if (/rate limit/i.test(msg)) return "Rate limited, retrying shortly";
  if (!msg || /failed to fetch|network|load failed/i.test(msg)) {
    return "Network error, retrying";
  }
  return msg.length > 80 ? `${msg.slice(0, 79)}…` : msg;
}

/**
 * Delay before retrying a failed background quote, or null when the failure is
 * not transient. Only 429s and network errors / timeouts are retried.
 */
function transientRetryDelay(err: unknown): number | null {
  let base: number | null = null;
  if (err instanceof QuoteError) {
    if (err.status === 429) base = err.retryAfterMs ?? DEFAULT_RETRY_AFTER_MS;
  } else if (
    err instanceof TypeError ||
    (err instanceof Error && err.name === "TimeoutError")
  ) {
    base = DEFAULT_RETRY_AFTER_MS;
  }
  if (base === null) return null;
  return Math.min(base, MAX_RETRY_AFTER_MS) + Math.floor(Math.random() * RETRY_JITTER_MS);
}

function rfqExpiringSoon(order: JupiterOrder): boolean {
  if (order.expireAt === undefined || order.expireAt === null) return false;
  const seconds = Number(order.expireAt);
  if (!Number.isFinite(seconds) || seconds <= 0) return false;
  return seconds * 1000 - Date.now() < RFQ_MIN_REMAINING_MS;
}

/**
 * The transaction id, known before submission when the wallet is the fee payer
 * (signature 0). Gasless orders are fee-paid by someone else: unknown here.
 */
function feePayerSignature(tx: VersionedTransaction, wallet: PublicKey): string | undefined {
  // Only used for status polling: an unexpected wallet return shape must never
  // block submitting the signed transaction.
  try {
    const payer = tx.message.staticAccountKeys[0];
    const sig = tx.signatures[0];
    if (!payer?.equals(wallet) || !sig || sig.every((b) => b === 0)) return undefined;
    return bytesToBase58(sig);
  } catch {
    return undefined;
  }
}

/** Rejects if `promise` takes longer than `ms` (RPC calls have no timeout). */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("RPC timeout")), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function parseBlockHeight(value: unknown): number | undefined {
  const n = typeof value === "string" ? Number(value) : value;
  return typeof n === "number" && Number.isSafeInteger(n) && n > 0 ? n : undefined;
}

/** The wallet must be one of the transaction's required signers. */
function assertWalletSigns(tx: VersionedTransaction, wallet: PublicKey) {
  const { staticAccountKeys, header } = tx.message;
  const idx = staticAccountKeys.findIndex((k) => k.equals(wallet));
  if (idx < 0 || idx >= header.numRequiredSignatures) {
    throw new Error("Transaction does not belong to your wallet");
  }
}

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

/**
 * Where a swap's pair and amount come from. Without one, useSwap reads the
 * Swap page's store; the trade terminal passes its own local state so it never
 * changes the Swap page's selected pair.
 */
export interface SwapSource {
  inputToken: TokenInfo;
  outputToken: TokenInfo;
  /** Exact decimal string typed by the user (never a float). */
  inputAmount: string;
  setInputAmount: (v: string) => void;
}

/** The provided source, else the Swap page's store (no-argument behaviour). */
export function resolveSwapSource(
  source: SwapSource | undefined,
  store: SwapSource
): SwapSource {
  return source ?? store;
}

/**
 * The quote request for a pair and amount, or null when there is nothing to
 * quote (empty / invalid amount, or the same mint on both sides). The key
 * identifies every input the quote depends on.
 */
export function buildQuoteRequest(args: {
  inputMint: string;
  outputMint: string;
  /** Base units, from toBaseUnits. */
  rawAmount: string | null;
  taker: string | undefined;
  slippage: SlippageSetting;
}): QuoteRequest | null {
  const { inputMint, outputMint, rawAmount, taker, slippage } = args;
  if (!rawAmount || inputMint === outputMint) return null;
  const slippageBps = slippage === "auto" ? undefined : slippage;
  return {
    key: [inputMint, outputMint, rawAmount, taker ?? "", slippageBps ?? "auto"].join("|"),
    inputMint,
    outputMint,
    amount: rawAmount,
    taker,
    slippageBps,
  };
}

export interface ExecuteSwapOptions {
  /** Price impact (percent) the user explicitly accepted for an extreme quote. */
  acceptedImpactPct?: number;
}

export function useSwap(source?: SwapSource) {
  const { publicKey, signTransaction } = useWallet();
  const { connection } = useConnection();
  const storeInputToken = useSwapStore((s) => s.inputToken);
  const storeOutputToken = useSwapStore((s) => s.outputToken);
  const storeInputAmount = useSwapStore((s) => s.inputAmount);
  const storeSetInputAmount = useSwapStore((s) => s.setInputAmount);
  const { inputToken, outputToken, inputAmount, setInputAmount } = resolveSwapSource(source, {
    inputToken: storeInputToken,
    outputToken: storeOutputToken,
    inputAmount: storeInputAmount,
    setInputAmount: storeSetInputAmount,
  });
  const slippage = useSettingsStore((s) => s.slippage);
  const refreshBalances = useRefreshBalances();

  const taker = publicKey?.toBase58();
  const rawAmount = useMemo(
    () => toBaseUnits(inputAmount, inputToken.decimals),
    [inputAmount, inputToken.decimals]
  );

  const request = useMemo(
    () =>
      buildQuoteRequest({
        inputMint: inputToken.mint,
        outputMint: outputToken.mint,
        rawAmount,
        taker,
        slippage,
      }),
    [rawAmount, inputToken.mint, outputToken.mint, taker, slippage]
  );

  const [result, setResult] = useState<QuoteResult | null>(null);
  const [inflightKey, setInflightKey] = useState<string | null>(null);
  const [swapping, setSwapping] = useState(false);
  const pending = usePendingSwapStore((s) => s.pending);
  const [now, setNow] = useState(0);

  const seqRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const swappingRef = useRef(false);
  const mountedRef = useRef(false);
  /** At most one scheduled quote retry (after a 429 / network error). */
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Bumped to stop this hook's pending-swap watcher. */
  const pendingSeqRef = useRef(0);
  const pendingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const watchingRef = useRef(false);
  const runQuoteRef = useRef<(req: QuoteRequest) => Promise<void>>(async () => {});
  const latestRef = useRef({ request, result, inputToken, outputToken, setInputAmount });
  useEffect(() => {
    latestRef.current = { request, result, inputToken, outputToken, setInputAmount };
  });

  /** Invalidates any in-flight quote so it can no longer set state. */
  const abortInflight = useCallback(() => {
    seqRef.current++;
    abortRef.current?.abort();
    abortRef.current = null;
  }, []);

  /** abortInflight + clears the refresh spinner (a cancelled run never does). */
  const cancelInflight = useCallback(() => {
    abortInflight();
    setInflightKey(null);
  }, [abortInflight]);

  const clearRetry = useCallback(() => {
    if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
    retryTimerRef.current = null;
  }, []);

  /** Replaces any scheduled retry: never more than one timer. */
  const scheduleRetry = useCallback(
    (delayMs: number) => {
      clearRetry();
      // A request that fails after unmount must not start a retry loop.
      if (!mountedRef.current) return;
      retryTimerRef.current = setTimeout(() => {
        retryTimerRef.current = null;
        // Hidden tabs wait for the visibility / interval refresh instead.
        if (document.visibilityState !== "visible") return;
        const latest = latestRef.current.request;
        if (latest) void runQuoteRef.current(latest);
      }, delayMs);
    },
    [clearRetry]
  );

  const runQuote = useCallback(
    async (req: QuoteRequest) => {
      if (swappingRef.current) return;
      clearRetry(); // this run supersedes any scheduled retry
      cancelInflight();
      const seq = seqRef.current;
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      setInflightKey(req.key);
      try {
        const order = await fetchOrder(req, ctrl.signal);
        if (seq !== seqRef.current) return;
        setResult({ key: req.key, order, error: null, fetchedAt: Date.now() });
      } catch (err) {
        if (seq !== seqRef.current || ctrl.signal.aborted) return;
        const retryIn = transientRetryDelay(err);
        const error = quoteErrorMessage(err);
        // A transient failure keeps the order on screen (marked stale) rather
        // than replacing a valid quote with an error.
        setResult((prev) =>
          retryIn !== null && prev?.key === req.key && prev.order
            ? { ...prev, stale: true }
            : { key: req.key, order: null, error, fetchedAt: Date.now() }
        );
        if (retryIn !== null) scheduleRetry(retryIn);
      } finally {
        if (seq === seqRef.current) {
          abortRef.current = null;
          setInflightKey(null);
        }
      }
    },
    [cancelInflight, clearRetry, scheduleRetry]
  );
  useEffect(() => {
    runQuoteRef.current = runQuote;
  }, [runQuote]);

  // Debounced quote whenever tokens / amount / slippage / wallet change.
  useEffect(() => {
    // No spinner can show without a request, so the refs-only abort suffices.
    if (!request) {
      abortInflight();
      return;
    }
    // Backing off after a 429: the scheduled retry picks up the latest request.
    if (retryTimerRef.current) return;
    const t = setTimeout(() => void runQuote(request), QUOTE_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [request, runQuote, abortInflight]);

  // Auto-refresh while idle and visible (paused while a retry is scheduled).
  useEffect(() => {
    if (!request || swapping) return;
    const id = setInterval(() => {
      if (document.visibilityState !== "visible" || swappingRef.current) return;
      if (retryTimerRef.current) return;
      void runQuote(request);
    }, QUOTE_REFRESH_MS);
    const onVisibility = () => {
      if (document.visibilityState !== "visible" || swappingRef.current) return;
      if (retryTimerRef.current) return;
      const r = latestRef.current.result;
      if (!r || r.key !== request.key || Date.now() - r.fetchedAt > QUOTE_REFRESH_MS) {
        void runQuote(request);
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [request, swapping, runQuote]);

  // Clock for staleness display.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 5_000);
    return () => clearInterval(id);
  }, []);

  /** Stops this hook's watcher; the block itself stays in the store. */
  const stopPendingWatch = useCallback(() => {
    pendingSeqRef.current++;
    watchingRef.current = false;
    if (pendingTimerRef.current) clearTimeout(pendingTimerRef.current);
    pendingTimerRef.current = null;
  }, []);

  const dismissPending = useCallback(() => {
    stopPendingWatch();
    usePendingSwapStore.getState().clearPending();
  }, [stopPendingWatch]);

  /**
   * Blocks new swaps while an unknown-outcome swap may still land. With a known
   * signature, polls its status until it confirms, fails, or can no longer land
   * (blockhash expired / 90s); without one (gasless), waits out 90s unless the
   * user dismisses it after checking their wallet.
   */
  const watchPending = useCallback(
    (p: PendingSwap) => {
      stopPendingWatch();
      const seq = pendingSeqRef.current;
      const alive = () => seq === pendingSeqRef.current;
      watchingRef.current = true;
      const deadline = p.until;
      const finish = () => {
        if (!alive()) return;
        stopPendingWatch();
        usePendingSwapStore.getState().clearPending(p);
        refreshBalances();
      };
      const wait = (ms: number) =>
        new Promise<void>((resolve) => {
          pendingTimerRef.current = setTimeout(resolve, ms);
        });
      const action = solscanAction(p.signature);
      const opts = { id: p.toastId, action, duration: 10_000 };

      const run = async () => {
        const signature = p.signature;
        if (!signature) {
          await wait(Math.max(0, deadline - Date.now()));
          if (!alive()) return;
          toast("Previous swap window has passed. Check your wallet activity before swapping again", opts);
          finish();
          return;
        }
        let expired = false;
        for (;;) {
          await wait(STATUS_POLL_MS);
          if (!alive()) return;
          let checked = false;
          let seen = false;
          try {
            const { value } = await withTimeout(
              connection.getSignatureStatuses([signature], { searchTransactionHistory: true }),
              RPC_TIMEOUT_MS
            );
            if (!alive()) return;
            const st = value[0];
            checked = true;
            seen = !!st;
            if (st?.err) {
              toast.error("Swap failed on chain", opts);
              finish();
              return;
            }
            if (st?.confirmationStatus === "confirmed" || st?.confirmationStatus === "finalized") {
              toast.success(`Swap confirmed: ${p.summary}`, opts);
              finish();
              return;
            }
          } catch {
            if (!alive()) return;
            // RPC hiccup: keep polling until the deadline.
          }
          // Only a successful lookup after expiry proves it can no longer land.
          if (expired && checked && !seen) {
            toast.error("Swap did not land (transaction expired). You can swap again", opts);
            finish();
            return;
          }
          if (Date.now() >= deadline) {
            toast.error("Swap not confirmed after 90s. Check your wallet activity before retrying", opts);
            finish();
            return;
          }
          if (p.lastValidBlockHeight !== undefined && !expired) {
            try {
              const height = await withTimeout(connection.getBlockHeight("confirmed"), RPC_TIMEOUT_MS);
              if (!alive()) return;
              // Re-check the status once more before declaring it dropped.
              if (height > p.lastValidBlockHeight) expired = true;
            } catch {
              if (!alive()) return;
            }
          }
        }
      };
      void run();
    },
    [connection, refreshBalances, stopPendingWatch]
  );

  // Abort on unmount. The pending-swap block stays in its store (it is keyed to
  // a wallet), so a reconnect or leaving /swap cannot lift it early.
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      cancelInflight();
      clearRetry();
      stopPendingWatch();
    };
  }, [cancelInflight, clearRetry, stopPendingWatch]);

  // Resume watching a block that outlived an earlier mount of this hook.
  useEffect(() => {
    if (watchingRef.current) return;
    const p = usePendingSwapStore.getState().pending;
    if (!p) return;
    if (p.until <= Date.now()) usePendingSwapStore.getState().clearPending(p);
    else watchPending(p);
  }, [watchPending]);

  const matching = request && result?.key === request.key ? result : null;
  const order = matching?.order ?? null;
  const quoteError = matching?.error ?? null;
  const isQuoting = !!request && !matching;
  const isRefreshing = !!matching && inflightKey === matching.key;
  const isStale =
    !!matching &&
    (!!matching.stale || (now > 0 && now - matching.fetchedAt > STALE_AFTER_MS));
  const activePending =
    pending && pending.wallet === taker && (now === 0 || pending.until > now) ? pending : null;

  const orderError =
    order && order.transaction === ""
      ? describeOrderError(order.router, order.errorCode, order.errorMessage ?? order.error)
      : null;

  const derived = useMemo(() => {
    if (!order) return null;
    const priceImpactPct = getPriceImpactPercent(order);
    const labels = (order.routePlan ?? [])
      .map((step) => step?.swapInfo?.label)
      .filter((l): l is string => typeof l === "string" && l.length > 0);
    return {
      outAmount: fromBaseUnits(order.outAmount, outputToken.decimals),
      minReceived: fromBaseUnits(order.otherAmountThreshold, outputToken.decimals),
      priceImpactPct,
      severity: getImpactSeverity(priceImpactPct),
      routeLabels: Array.from(new Set(labels)),
    };
  }, [order, outputToken.decimals]);

  const executeSwap = useCallback(
    async (opts: ExecuteSwapOptions = {}) => {
      if (swappingRef.current) return;
      if (!publicKey) {
        toast.error("Connect your wallet first");
        return;
      }
      // An earlier swap from this wallet may still land.
      if (isSwapBlocked(publicKey.toBase58())) return;
      if (!signTransaction) {
        toast.error("This wallet cannot sign transactions");
        return;
      }
      const snap = latestRef.current;
      const req = snap.request;
      const shown =
        req && snap.result?.key === req.key ? snap.result : null;
      // Only ever sign for the quote currently on screen, for this wallet.
      if (!req || !shown?.order || req.taker !== publicKey.toBase58()) return;

      swappingRef.current = true;
      setSwapping(true);
      cancelInflight(); // no background quote may replace the displayed one
      const inTok = snap.inputToken;
      const outTok = snap.outputToken;
      const toastId = toast.loading("Preparing swap...");
      let requote = false;

      try {
        let order = shown.order;
        const tooOld = Date.now() - shown.fetchedAt > MAX_ORDER_AGE_MS;
        if (!order.transaction || tooOld || rfqExpiringSoon(order)) {
          toast.loading("Refreshing quote...", { id: toastId });
          const fresh = await fetchOrder(req);
          // Show the order we are about to sign.
          setResult({ key: req.key, order: fresh, error: null, fetchedAt: Date.now() });
          if (!fresh.transaction) {
            toast.error(
              describeOrderError(fresh.router, fresh.errorCode, fresh.errorMessage ?? fresh.error),
              { id: toastId }
            );
            return;
          }
          // The user agreed to what was shown, minimum received included.
          const verdict = checkRequote(fresh, order);
          if (verdict !== "ok") {
            toast.warning(
              verdict === "price-moved"
                ? "Price moved. Review the new quote and press Swap again"
                : "Quote changed (minimum received is lower). Review and press Swap again",
              { id: toastId }
            );
            return;
          }
          order = fresh;
        }

        const impact = getPriceImpactPercent(order);
        if (
          getImpactSeverity(impact) === "extreme" &&
          !(opts.acceptedImpactPct !== undefined && impact <= opts.acceptedImpactPct + 0.5)
        ) {
          toast.warning("Price impact changed. Review and confirm again", { id: toastId });
          return;
        }

        const tx = VersionedTransaction.deserialize(base64ToBytes(order.transaction!));
        assertWalletSigns(tx, publicKey);

        toast.loading("Confirm in your wallet...", { id: toastId });
        const signed = await signTransaction(tx);
        // Known before submission when the wallet pays the fee (not gasless).
        const localSignature = feePayerSignature(signed, publicKey);
        // Serialised before the request: a failure here is definite (not sent).
        const signedTransaction = bytesToBase64(signed.serialize());

        toast.loading("Executing swap...", { id: toastId });
        let data: Partial<JupiterExecuteResult> | null = null;
        try {
          const res = await fetch("/api/jupiter/execute", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ signedTransaction, requestId: order.requestId }),
            signal: AbortSignal.timeout(EXECUTE_CLIENT_TIMEOUT_MS),
          });
          data = (await res.json().catch(() => null)) as Partial<JupiterExecuteResult> | null;
        } catch {
          data = { status: "Failed", code: EXECUTE_UNKNOWN_STATUS_CODE };
        }
        if (!data || typeof data !== "object") {
          data = { status: "Failed", code: EXECUTE_UNKNOWN_STATUS_CODE };
        }

        const signature =
          (typeof data.signature === "string" && data.signature ? data.signature : undefined) ??
          localSignature;

        const inUi = formatTokenAmount(fromBaseUnits(order.inAmount, inTok.decimals));
        if (data.status === "Success") {
          const inRaw =
            typeof data.totalInputAmount === "string" && DIGITS.test(data.totalInputAmount)
              ? data.totalInputAmount
              : order.inAmount;
          const outRaw =
            typeof data.totalOutputAmount === "string" && DIGITS.test(data.totalOutputAmount)
              ? data.totalOutputAmount
              : order.outAmount;
          const inUiFinal = formatTokenAmount(fromBaseUnits(inRaw, inTok.decimals));
          const outUi = formatTokenAmount(fromBaseUnits(outRaw, outTok.decimals));
          toast.success(`Swapped ${inUiFinal} ${inTok.symbol} for ${outUi} ${outTok.symbol}`, {
            id: toastId,
            action: solscanAction(signature),
            duration: 10_000,
          });
          // The order's requestId is consumed: never show or reuse it again.
          setResult(null);
          latestRef.current.setInputAmount("");
        } else if (isUnknownExecuteOutcome(data.code)) {
          // It may still land: never re-sign this requestId, and block new
          // swaps until the outcome is known (or can no longer change).
          setResult(null);
          latestRef.current.setInputAmount("");
          toast.warning(
            signature
              ? "Swap status unknown. Checking whether it landed..."
              : describeExecuteError(EXECUTE_UNKNOWN_STATUS_CODE),
            { id: toastId, action: solscanAction(signature), duration: PENDING_MAX_MS }
          );
          const record: PendingSwap = {
            wallet: publicKey.toBase58(),
            signature,
            lastValidBlockHeight: parseBlockHeight(order.lastValidBlockHeight),
            until: Date.now() + PENDING_MAX_MS,
            toastId,
            summary: `${inUi} ${inTok.symbol} → ${outTok.symbol}`,
          };
          // Recorded even if unmounted: a later mount resumes watching it.
          usePendingSwapStore.getState().setPending(record);
          if (mountedRef.current) watchPending(record);
        } else {
          requote = true;
          toast.error(describeExecuteError(data.code, data.error), {
            id: toastId,
            action: solscanAction(signature),
            duration: 10_000,
          });
        }
      } catch (err) {
        if (isUserRejection(err)) {
          toast("Swap cancelled", { id: toastId });
        } else {
          const retryIn = transientRetryDelay(err);
          // Rate limited / offline while re-fetching: back off, don't hammer.
          if (retryIn !== null) scheduleRetry(retryIn);
          else requote = true;
          const msg = err instanceof Error && err.message ? err.message : "Swap failed";
          toast.error(msg.length > 120 ? `${msg.slice(0, 119)}…` : msg, { id: toastId });
        }
      } finally {
        swappingRef.current = false;
        setSwapping(false);
        refreshBalances();
        // RPC nodes can lag a few seconds behind the landed transaction.
        setTimeout(refreshBalances, 4_000);
        // Requote after a failure, or if the inputs changed while swapping.
        const latest = latestRef.current.request;
        if (mountedRef.current && latest && (requote || latest.key !== req.key)) {
          void runQuote(latest);
        }
      }
    },
    [
      publicKey,
      signTransaction,
      cancelInflight,
      runQuote,
      scheduleRetry,
      refreshBalances,
      watchPending,
    ]
  );

  const refresh = useCallback(() => {
    const req = latestRef.current.request;
    if (req) void runQuote(req);
  }, [runQuote]);

  return {
    order,
    rawAmount,
    outAmount: derived?.outAmount ?? "",
    minReceived: derived?.minReceived ?? "",
    priceImpactPct: derived?.priceImpactPct ?? 0,
    severity: derived?.severity ?? "low",
    routeLabels: derived?.routeLabels ?? [],
    router: order?.router ?? null,
    feeBps: typeof order?.feeBps === "number" ? order.feeBps : null,
    isQuoting,
    isRefreshing,
    quoteError,
    orderError,
    isStale,
    executeSwap,
    swapping,
    /** An earlier swap's outcome is unknown and it may still land: block swaps. */
    pendingSwap: activePending
      ? { signature: activePending.signature, canDismiss: !activePending.signature }
      : null,
    dismissPending,
    refresh,
  };
}
