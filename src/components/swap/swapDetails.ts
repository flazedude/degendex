import BigNumber from "bignumber.js";
import { SOL_MINT } from "@/lib/constants";
import { formatTokenAmount, fromBaseUnits, safeBigNumber } from "@/lib/amounts";
import type { ImpactSeverity } from "@/lib/jupiter/priceImpact";
import type { JupiterOrder } from "@/lib/jupiter/types";
import type { SlippageSetting } from "@/store/useSettingsStore";

// Shared by the Swap card and the trade terminal's market order form.

/** Kept back on MAX for SOL: network fees, ATA rent, wrapping. */
export const SOL_FEE_RESERVE_LAMPORTS = 10_000_000; // 0.01 SOL

export const ROUTER_NAMES: Record<string, string> = {
  metis: "Metis",
  jupiterz: "JupiterZ RFQ",
  dflow: "DFlow",
  okx: "OKX",
};

export const SEVERITY_CLASS: Record<ImpactSeverity, string> = {
  low: "text-primary",
  medium: "text-yellow-500",
  high: "text-orange-500",
  extreme: "text-destructive font-semibold",
};

export function slippageLabel(slippage: SlippageSetting): string {
  return slippage === "auto" ? "Auto" : `${slippage / 100}%`;
}

/**
 * What the wallet can spend of `mint` (base units): the balance, minus the
 * SOL fee reserve for native SOL. Null while the balance is unknown.
 */
export function getSpendableRaw(balanceRaw: string | undefined, mint: string): BigNumber | null {
  if (balanceRaw === undefined) return null;
  let b = safeBigNumber(balanceRaw);
  if (mint === SOL_MINT) b = b.minus(SOL_FEE_RESERVE_LAMPORTS);
  return BigNumber.max(b, 0);
}

/** A fraction of the spendable balance as a UI amount ("" when it rounds to 0). */
export function portionAmount(spendableRaw: BigNumber, fraction: number, decimals: number): string {
  const raw = spendableRaw.times(fraction).integerValue(BigNumber.ROUND_DOWN);
  return raw.gt(0) ? fromBaseUnits(raw.toFixed(0), decimals) : "";
}

/** True only when both are known and the amount exceeds the full balance. */
export function exceedsBalance(rawAmount: string | null, balanceRaw: string | undefined): boolean {
  return (
    !!rawAmount &&
    balanceRaw !== undefined &&
    safeBigNumber(rawAmount).gt(safeBigNumber(balanceRaw))
  );
}

/**
 * "1 IN = x OUT" from an order (or "1 OUT = x IN" when inverted); null when
 * either side is not positive.
 */
export function formatRate(
  order: Pick<JupiterOrder, "inAmount"> | null,
  outAmountUi: string,
  input: { symbol: string; decimals: number },
  output: { symbol: string },
  invert: boolean
): string | null {
  if (!order) return null;
  const inUi = safeBigNumber(fromBaseUnits(order.inAmount, input.decimals));
  const outUi = safeBigNumber(outAmountUi);
  if (!inUi.gt(0) || !outUi.gt(0)) return null;
  return invert
    ? `1 ${output.symbol} = ${formatTokenAmount(inUi.div(outUi).toFixed())} ${input.symbol}`
    : `1 ${input.symbol} = ${formatTokenAmount(outUi.div(inUi).toFixed())} ${output.symbol}`;
}

/** "Router: Label › Label", or an em dash when nothing is known. */
export function routeText(router: string | null, routeLabels: string[]): string {
  return (
    [router ? (ROUTER_NAMES[router] ?? router) : null, routeLabels.join(" › ")]
      .filter(Boolean)
      .join(": ") || "—"
  );
}

export interface SlippageDisplay {
  slippageText: string;
  /**
   * The order's threshold is not a real minimum, so it must not be shown as
   * one: without a taker (no wallet) Jupiter does not set Auto slippage and
   * the threshold equals the quote.
   */
  minReceivedUnknown: boolean;
}

/**
 * Slippage row text and whether "minimum received" can be shown honestly.
 * RFQ (JupiterZ) fills at the quoted price, so there the minimum is the quote.
 */
export function slippageDisplay(
  order: Pick<JupiterOrder, "router" | "transaction" | "slippageBps"> | null,
  slippage: SlippageSetting
): SlippageDisplay {
  const isRfq = order?.router === "jupiterz";
  const noTaker = order?.transaction === null;
  const orderSlippageBps =
    typeof order?.slippageBps === "number" && Number.isFinite(order.slippageBps)
      ? order.slippageBps
      : null;
  let slippageText: string;
  if (isRfq) {
    slippageText = "Fixed price (RFQ)";
  } else if (noTaker) {
    slippageText = slippage === "auto" ? "Auto (set when you connect)" : slippageLabel(slippage);
  } else if (orderSlippageBps === null) {
    slippageText = slippageLabel(slippage);
  } else {
    const pct = `${orderSlippageBps / 100}%`;
    slippageText = slippage === "auto" ? `Auto (${pct})` : pct;
  }
  return { slippageText, minReceivedUnknown: noTaker && !isRfq && slippage === "auto" };
}
