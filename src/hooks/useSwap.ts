"use client";

import { useCallback, useEffect, useRef } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { VersionedTransaction } from "@solana/web3.js";
import { useSwapStore } from "@/store/useSwapStore";
import { useSettingsStore } from "@/store/useSettingsStore";
import {
  getQuote,
  getSwapTransaction,
  type JupiterQuoteResponse,
} from "@/lib/solana/jupiter";
import { toast } from "sonner";
import { useState } from "react";

export function useSwap() {
  const { connection } = useConnection();
  const { publicKey, signTransaction } = useWallet();
  const {
    inputToken,
    outputToken,
    inputAmount,
    setOutputAmount,
    loading,
    setLoading,
  } = useSwapStore();
  const { slippageBps, priorityFee } = useSettingsStore();

  const [quote, setQuote] = useState<JupiterQuoteResponse | null>(null);
  const debounceRef = useRef<NodeJS.Timeout | null>(null);

  // Fetch quote when input changes
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);

    if (!inputAmount || parseFloat(inputAmount) <= 0) {
      setOutputAmount("");
      setQuote(null);
      return;
    }

    debounceRef.current = setTimeout(async () => {
      try {
        setLoading(true);
        const amountInSmallestUnit = Math.floor(
          parseFloat(inputAmount) * 10 ** inputToken.decimals
        ).toString();

        const quoteResponse = await getQuote(
          inputToken.mint,
          outputToken.mint,
          amountInSmallestUnit,
          slippageBps
        );

        setQuote(quoteResponse);
        const outAmount =
          parseFloat(quoteResponse.outAmount) / 10 ** outputToken.decimals;
        setOutputAmount(outAmount.toString());
      } catch (error) {
        console.error("Quote error:", error);
        setOutputAmount("");
        setQuote(null);
      } finally {
        setLoading(false);
      }
    }, 500);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [
    inputAmount,
    inputToken.mint,
    outputToken.mint,
    inputToken.decimals,
    outputToken.decimals,
    slippageBps,
    setOutputAmount,
    setLoading,
  ]);

  const executeSwap = useCallback(async () => {
    if (!publicKey || !signTransaction || !quote) {
      toast.error("Connect your wallet first");
      return;
    }

    try {
      setLoading(true);
      toast.loading("Preparing swap...", { id: "swap" });

      const swapResponse = await getSwapTransaction(
        quote,
        publicKey.toBase58(),
        priorityFee
      );

      const swapTransactionBuf = Buffer.from(
        swapResponse.swapTransaction,
        "base64"
      );
      const transaction =
        VersionedTransaction.deserialize(swapTransactionBuf);

      toast.loading("Confirm in your wallet...", { id: "swap" });
      const signedTransaction = await signTransaction(transaction);

      toast.loading("Sending transaction...", { id: "swap" });
      const txid = await connection.sendRawTransaction(
        signedTransaction.serialize(),
        { maxRetries: 3 }
      );

      toast.loading("Confirming...", { id: "swap" });
      await connection.confirmTransaction(txid, "confirmed");

      toast.success(
        `Swapped ${inputAmount} ${inputToken.symbol} for ${outputToken.symbol}`,
        { id: "swap" }
      );
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : "Swap failed";
      toast.error(message, { id: "swap" });
    } finally {
      setLoading(false);
    }
  }, [
    publicKey,
    signTransaction,
    quote,
    connection,
    inputAmount,
    inputToken,
    outputToken,
    priorityFee,
    setLoading,
  ]);

  return {
    quote,
    executeSwap,
    loading,
    priceImpact: quote ? parseFloat(quote.priceImpactPct) : null,
  };
}
