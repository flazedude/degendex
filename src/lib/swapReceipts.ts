import { isValidPubkey, isValidSolanaSignature, U64_MAX } from "@/lib/jupiter/params";
import type { JupiterExecuteResult } from "@/lib/jupiter/types";

export type SwapReceiptToken = {
  mint: string;
  symbol: string;
  decimals: number;
};

export interface SwapReceipt {
  wallet: string;
  signature: string;
  confirmedAt: number;
  input: SwapReceiptToken;
  output: SwapReceiptToken;
  inputAmountRaw: string | null;
  outputAmountRaw: string | null;
}

function parseReceiptToken(value: unknown): SwapReceiptToken | null {
  if (!value || typeof value !== "object") return null;
  const { mint, symbol, decimals } = value as Record<string, unknown>;
  if (!isValidPubkey(mint) || typeof decimals !== "number" ||
    !Number.isInteger(decimals) || decimals < 0 || decimals > 255) return null;

  const label = typeof symbol === "string" ? symbol.trim().slice(0, 64) : "";
  return { mint, decimals, symbol: label || `${mint.slice(0, 4)}…${mint.slice(-4)}` };
}

function parseReceiptAmount(value: unknown): string | null {
  if (typeof value !== "string" || !/^\d{1,20}$/.test(value)) return null;
  const amount = BigInt(value);
  return amount <= U64_MAX ? amount.toString() : null;
}

/** Validate browser storage and keep only receipt metadata. */
export function parseSwapReceipt(value: unknown): SwapReceipt | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const { wallet, signature, confirmedAt } = row;
  if (
    !isValidPubkey(wallet) || !isValidSolanaSignature(signature) ||
    typeof confirmedAt !== "number" || !Number.isSafeInteger(confirmedAt) ||
    confirmedAt <= 0 || confirmedAt > 8.64e15
  ) return null;

  const input = parseReceiptToken(row.input);
  const output = parseReceiptToken(row.output);
  if (!input || !output || input.mint === output.mint) return null;
  return {
    wallet, signature, confirmedAt, input, output,
    inputAmountRaw: parseReceiptAmount(row.inputAmountRaw),
    outputAmountRaw: parseReceiptAmount(row.outputAmountRaw),
  };
}

type ReceiptContext = Omit<SwapReceipt, "signature" | "inputAmountRaw" | "outputAmountRaw"> & {
  signature?: string;
};

/** Use wallet totals from a completed execution. Route amounts exclude some fees. */
export function receiptFromExecute(
  context: ReceiptContext,
  result: Partial<JupiterExecuteResult>
): SwapReceipt | null {
  if (result.status !== "Success" || result.code !== 0) return null;
  return parseSwapReceipt({
    ...context,
    inputAmountRaw: result.totalInputAmount,
    outputAmountRaw: result.totalOutputAmount,
  });
}

export function swapExplorerAction(signature: string | undefined) {
  if (!isValidSolanaSignature(signature)) return undefined;
  return {
    label: "Solscan",
    onClick: () => {
      window.open(`https://solscan.io/tx/${signature}`, "_blank", "noopener,noreferrer");
    },
  };
}
