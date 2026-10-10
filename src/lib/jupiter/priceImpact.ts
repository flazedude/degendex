import type { JupiterOrder } from "./types";

export type ImpactSeverity = "low" | "medium" | "high" | "extreme";

/**
 * Absolute LOSS percent (>= 0) for an order. Jupiter reports negative impact
 * when the user receives less than fair value; positive (favorable) impact is
 * reported as 0. Prefers the numeric `priceImpact` (already percent), else
 * `priceImpactPct` (a fraction string). Missing data yields 0.
 */
export function getPriceImpactPercent(
  order: Pick<JupiterOrder, "priceImpact" | "priceImpactPct"> | null | undefined
): number {
  if (!order) return 0;
  let pct: number | null = null;
  if (typeof order.priceImpact === "number" && Number.isFinite(order.priceImpact)) {
    pct = order.priceImpact;
  } else if (order.priceImpactPct !== undefined && order.priceImpactPct !== null) {
    const fraction = parseFloat(String(order.priceImpactPct));
    if (Number.isFinite(fraction)) pct = fraction * 100;
  }
  if (pct === null || pct >= 0) return 0;
  return -pct;
}

export function getImpactSeverity(pct: number): ImpactSeverity {
  if (!Number.isFinite(pct) || pct >= 15) return "extreme";
  if (pct >= 5) return "high";
  if (pct >= 1) return "medium";
  return "low";
}

export function formatPriceImpact(pct: number): string {
  if (!Number.isFinite(pct)) return "—";
  if (pct < 0.01) return "<0.01%";
  return `${pct.toFixed(2)}%`;
}
