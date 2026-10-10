"use client";

import { useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { useSwapStore } from "@/store/useSwapStore";
import { isValidPubkey } from "@/lib/jupiter/params";
import { fetchTokens } from "@/lib/tokens/map";

/**
 * Applies /swap?inputMint=<mint>&outputMint=<mint> (either optional) to the
 * swap store. Mints are resolved through Jupiter so decimals are never guessed;
 * invalid or unknown mints are ignored.
 */
export function SwapDeepLink() {
  const searchParams = useSearchParams();
  const inputParam = searchParams.get("inputMint")?.trim() ?? "";
  const outputParam = searchParams.get("outputMint")?.trim() ?? "";

  useEffect(() => {
    const inputMint = isValidPubkey(inputParam) ? inputParam : null;
    let outputMint = isValidPubkey(outputParam) ? outputParam : null;
    if (inputMint && outputMint === inputMint) outputMint = null;
    if (!inputMint && !outputMint) return;

    const ctrl = new AbortController();
    const mints = [inputMint, outputMint].filter((m): m is string => !!m);
    fetchTokens(mints.join(","), ctrl.signal)
      .then((tokens) => {
        if (ctrl.signal.aborted) return;
        const input = inputMint ? tokens.find((t) => t.mint === inputMint) : undefined;
        const output = outputMint ? tokens.find((t) => t.mint === outputMint) : undefined;
        const store = useSwapStore.getState();
        if (input && output) store.setTokens(input, output);
        else if (input) store.setInputToken(input);
        else if (output) store.setOutputToken(output);
      })
      .catch(() => {
        // Network/API failure: keep the default pair.
      });
    return () => ctrl.abort();
  }, [inputParam, outputParam]);

  return null;
}
