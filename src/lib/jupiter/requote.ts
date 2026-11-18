import BigNumber from "bignumber.js";
import type { JupiterOrder } from "./types";

/** A re-fetched order may be at most this much worse than the one displayed. */
export const MAX_ADVERSE_REQUOTE_BPS = 50;

export type RequoteVerdict = "ok" | "price-moved" | "min-received-lower";

type Amounts = Pick<JupiterOrder, "outAmount" | "otherAmountThreshold">;

function floorOf(value: string): BigNumber {
  return new BigNumber(value).times(10_000 - MAX_ADVERSE_REQUOTE_BPS).div(10_000);
}

/**
 * Compares the order re-fetched just before signing with the one on screen.
 * Anything other than "ok" must stop for review: the user only agreed to what
 * was shown, including the on-chain minimum (otherAmountThreshold), which can
 * drop on its own when Auto slippage or the router changes.
 */
export function checkRequote(fresh: Amounts, shown: Amounts): RequoteVerdict {
  if (new BigNumber(fresh.outAmount).lt(floorOf(shown.outAmount))) return "price-moved";
  if (new BigNumber(fresh.otherAmountThreshold).lt(floorOf(shown.otherAmountThreshold))) {
    return "min-received-lower";
  }
  return "ok";
}
