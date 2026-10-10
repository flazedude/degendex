"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { VersionedTransaction, type PublicKey } from "@solana/web3.js";
import BigNumber from "bignumber.js";
import { toast } from "sonner";
import { useSwapStore } from "@/store/useSwapStore";
import { useSettingsStore } from "@/store/useSettingsStore";
import { useRefreshBalances } from "@/hooks/useTokenBalance";
import { formatTokenAmount, fromBaseUnits, toBaseUnits } from "@/lib/amounts";
import { base64ToBytes, bytesToBase64 } from "@/lib/jupiter/encoding";
import {
  EXECUTE_UNKNOWN_STATUS_CODE,
  describeExecuteError,
  describeOrderError,
  isUserRejection,
} from "@/lib/jupiter/errors";
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
/** A re-fetched order may be at most this much worse than the one displayed. */
const MAX_ADVERSE_REQUOTE_BPS = 50;
const EXECUTE_CLIENT_TIMEOUT_MS = 75_000;

interface QuoteRequest {
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
    throw new Error(errorText(body) ?? `Quote failed (${res.status})`);
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

function rfqExpiringSoon(order: JupiterOrder): boolean {
  if (order.expireAt === undefined || order.expireAt === null) return false;
  const seconds = Number(order.expireAt);
  if (!Number.isFinite(seconds) || seconds <= 0) return false;
  return seconds * 1000 - Date.now() < RFQ_MIN_REMAINING_MS;
}

function isMuchWorse(fresh: JupiterOrder, shown: JupiterOrder): boolean {
  const floor = new BigNumber(shown.outAmount)
    .times(10_000 - MAX_ADVERSE_REQUOTE_BPS)
    .div(10_000);
  return new BigNumber(fresh.outAmount).lt(floor);
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

export interface ExecuteSwapOptions {
  /** Price impact (percent) the user explicitly accepted for an extreme quote. */
  acceptedImpactPct?: number;
}

export function useSwap() {
  const { publicKey, signTransaction } = useWallet();
  const inputToken = useSwapStore((s) => s.inputToken);
  const outputToken = useSwapStore((s) => s.outputToken);
  const inputAmount = useSwapStore((s) => s.inputAmount);
  const setInputAmount = useSwapStore((s) => s.setInputAmount);
  const slippage = useSettingsStore((s) => s.slippage);
  const refreshBalances = useRefreshBalances();

  const taker = publicKey?.toBase58();
  const rawAmount = useMemo(
    () => toBaseUnits(inputAmount, inputToken.decimals),
    [inputAmount, inputToken.decimals]
  );

  const request = useMemo<QuoteRequest | null>(() => {
    if (!rawAmount || inputToken.mint === outputToken.mint) return null;
    const slippageBps = slippage === "auto" ? undefined : slippage;
    return {
      key: [
        inputToken.mint,
        outputToken.mint,
        rawAmount,
        taker ?? "",
        slippageBps ?? "auto",
      ].join("|"),
      inputMint: inputToken.mint,
      outputMint: outputToken.mint,
      amount: rawAmount,
      taker,
      slippageBps,
    };
  }, [rawAmount, inputToken.mint, outputToken.mint, taker, slippage]);

  const [result, setResult] = useState<QuoteResult | null>(null);
  const [inflightKey, setInflightKey] = useState<string | null>(null);
  const [swapping, setSwapping] = useState(false);
  const [now, setNow] = useState(0);

  const seqRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const swappingRef = useRef(false);
  const latestRef = useRef({ request, result, inputToken, outputToken });
  useEffect(() => {
    latestRef.current = { request, result, inputToken, outputToken };
  });

  /** Invalidates any in-flight quote so it can no longer set state. */
  const cancelInflight = useCallback(() => {
    seqRef.current++;
    abortRef.current?.abort();
    abortRef.current = null;
  }, []);

  const runQuote = useCallback(
    async (req: QuoteRequest) => {
      if (swappingRef.current) return;
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
        setResult({
          key: req.key,
          order: null,
          error: quoteErrorMessage(err),
          fetchedAt: Date.now(),
        });
      } finally {
        if (seq === seqRef.current) {
          abortRef.current = null;
          setInflightKey(null);
        }
      }
    },
    [cancelInflight]
  );

  // Debounced quote whenever tokens / amount / slippage / wallet change.
  useEffect(() => {
    if (!request) {
      cancelInflight();
      return;
    }
    const t = setTimeout(() => void runQuote(request), QUOTE_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [request, runQuote, cancelInflight]);

  // Auto-refresh while idle and visible.
  useEffect(() => {
    if (!request || swapping) return;
    const id = setInterval(() => {
      if (document.visibilityState !== "visible" || swappingRef.current) return;
      void runQuote(request);
    }, QUOTE_REFRESH_MS);
    const onVisibility = () => {
      if (document.visibilityState !== "visible" || swappingRef.current) return;
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

  // Abort on unmount.
  useEffect(() => cancelInflight, [cancelInflight]);

  const matching = request && result?.key === request.key ? result : null;
  const order = matching?.order ?? null;
  const quoteError = matching?.error ?? null;
  const isQuoting = !!request && !matching;
  const isRefreshing = !!matching && inflightKey === matching.key;
  const isStale =
    !!matching && now > 0 && now - matching.fetchedAt > STALE_AFTER_MS;

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
          if (isMuchWorse(fresh, order)) {
            toast.warning("Price moved. Review the new quote and press Swap again", {
              id: toastId,
            });
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

        toast.loading("Executing swap...", { id: toastId });
        let data: Partial<JupiterExecuteResult> | null = null;
        try {
          const res = await fetch("/api/jupiter/execute", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              signedTransaction: bytesToBase64(signed.serialize()),
              requestId: order.requestId,
            }),
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
          typeof data.signature === "string" && data.signature ? data.signature : undefined;

        if (data.status === "Success") {
          const inRaw =
            typeof data.totalInputAmount === "string" && DIGITS.test(data.totalInputAmount)
              ? data.totalInputAmount
              : order.inAmount;
          const outRaw =
            typeof data.totalOutputAmount === "string" && DIGITS.test(data.totalOutputAmount)
              ? data.totalOutputAmount
              : order.outAmount;
          const inUi = formatTokenAmount(fromBaseUnits(inRaw, inTok.decimals));
          const outUi = formatTokenAmount(fromBaseUnits(outRaw, outTok.decimals));
          toast.success(`Swapped ${inUi} ${inTok.symbol} for ${outUi} ${outTok.symbol}`, {
            id: toastId,
            action: solscanAction(signature),
            duration: 10_000,
          });
          // The order's requestId is consumed: never show or reuse it again.
          setResult(null);
          setInputAmount("");
        } else {
          requote = data.code !== EXECUTE_UNKNOWN_STATUS_CODE;
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
          requote = true;
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
        if (latest && (requote || latest.key !== req.key)) void runQuote(latest);
      }
    },
    [publicKey, signTransaction, cancelInflight, runQuote, refreshBalances, setInputAmount]
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
    refresh,
  };
}
