"use client";

import { useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { useSwapStore } from "@/store/useSwapStore";
import { isValidPubkey } from "@/lib/jupiter/params";
import { fetchTokens } from "@/lib/tokens/map";
import type { TokenInfo } from "@/lib/tokens/types";
import { shortenAddress } from "@/lib/utils";
import { resolveDeepLinkPair } from "./deepLinkPair";

/**
 * Applies /swap?inputMint=<mint>&outputMint=<mint> (either optional) to the
 * swap store. Mints are resolved through Jupiter so decimals are never guessed.
 * A requested mint that cannot be resolved is reported and its side falls back
 * to the default pair, so a stale token is never shown in its place. The amount
 * is cleared either way. No automatic retry (shared Jupiter rate limit).
 */
export function SwapDeepLink() {
  const searchParams = useSearchParams();
  const inputParam = searchParams.get("inputMint")?.trim() ?? "";
  const outputParam = searchParams.get("outputMint")?.trim() ?? "";

  useEffect(() => {
    // Malformed mints count as requested-but-unresolved (reported, not fetched).
    const inputMint = inputParam || null;
    let outputMint = outputParam || null;
    if (inputMint && outputMint === inputMint) outputMint = null;
    if (!inputMint && !outputMint) return;
    // Nothing may be quoted or signed for the previous pair while the
    // requested tokens load: no amount means no quote.
    useSwapStore.getState().setInputAmount("");

    const ctrl = new AbortController();
    const mints = [inputMint, outputMint].filter((m): m is string => !!m && isValidPubkey(m));
    const apply = (found: TokenInfo[]) => {
      const store = useSwapStore.getState();
      const pair = resolveDeepLinkPair(
        { input: store.inputToken, output: store.outputToken },
        { inputMint, outputMint },
        found
      );
      store.setTokens(pair.input, pair.output);
      store.setInputAmount("");
      for (const mint of pair.missing) {
        toast.error(`Could not load token ${shortenAddress(mint)}; pick it manually`, {
          id: `deeplink-${mint}`,
        });
      }
    };
    if (mints.length === 0) {
      apply([]);
      return;
    }
    fetchTokens(mints.join(","), ctrl.signal)
      .then((tokens) => {
        if (!ctrl.signal.aborted) apply(tokens);
      })
      .catch(() => {
        if (!ctrl.signal.aborted) apply([]);
      });
    return () => ctrl.abort();
  }, [inputParam, outputParam]);

  return null;
}
