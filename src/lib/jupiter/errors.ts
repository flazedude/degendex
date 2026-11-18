// Maps Jupiter error codes to short, user-facing strings.

/**
 * Local sentinel (not a Jupiter code): the proxy lost track of an /execute call
 * (timeout / network). The signed transaction may still land on chain.
 */
export const EXECUTE_UNKNOWN_STATUS_CODE = -10_000;

/**
 * Local sentinel: Jupiter rejected the /execute call with a 4xx that carried no
 * code (e.g. rate limited). Nothing was broadcast, so retrying is safe.
 */
export const EXECUTE_REJECTED_CODE = -10_001;

/**
 * /execute outcomes where the transaction may or may not have landed: our own
 * sentinel plus Jupiter's "unknown" codes (aggregator -1001, RFQ -2001). These
 * must never be treated as a definite failure that invites a blind retry.
 */
const UNKNOWN_OUTCOME_CODES = new Set([EXECUTE_UNKNOWN_STATUS_CODE, -1001, -2001]);

export function isUnknownExecuteOutcome(code: number | null | undefined): boolean {
  return typeof code === "number" && UNKNOWN_OUTCOME_CODES.has(code);
}

const AGGREGATOR_ROUTERS = new Set(["metis", "dflow", "okx"]);

function clip(text: string | null | undefined, max = 90): string | null {
  const t = text?.trim();
  if (!t) return null;
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

/** For an /order response whose transaction is "" (quote but no tx). */
export function describeOrderError(
  router: string | null | undefined,
  errorCode: number | null | undefined,
  errorMessage?: string | null
): string {
  if (router === "jupiterz") {
    switch (errorCode) {
      case 1:
        return "Insufficient balance";
      case 2:
        return "Missing token account for this swap";
      case 3:
        return "Quote could not be built, retrying";
    }
  } else if (router && AGGREGATOR_ROUTERS.has(router)) {
    switch (errorCode) {
      case 1:
        return "Insufficient balance";
      case 2:
        return "Not enough SOL for network fees";
      case 3:
        return "Amount too small for a gasless swap";
    }
  }
  return clip(errorMessage) ?? "Swap unavailable for this quote";
}

export function describeExecuteError(
  code: number | null | undefined,
  error?: string | null
): string {
  const detail = clip(error);
  if (detail && /slippage/i.test(detail)) {
    return "Price moved beyond your slippage tolerance";
  }
  switch (code) {
    case EXECUTE_UNKNOWN_STATUS_CODE:
      return "Swap status unknown. Check your wallet activity before retrying";
    case EXECUTE_REJECTED_CODE:
      return "Jupiter rejected the swap before sending it (nothing was submitted). Please try again";
    case -1:
      return "Quote expired, please try again";
    case -2:
    case -3:
    case -1002:
      return "Invalid transaction, please try again";
    case -1003:
      return "Transaction was not fully signed";
    case -1004:
      return "Transaction expired before landing, please try again";
    case -1000:
    case -2000:
      return "Transaction failed to land, please try again";
    case -2002:
      return "Invalid swap request";
    case -2003:
      return "Quote expired, please try again";
    case -2004:
      return "Swap rejected by market maker, please try again";
    case -1001:
    case -2001:
      return detail ? `Swap failed: ${detail}` : "Swap failed (unknown error)";
  }
  return detail ?? "Swap failed";
}

/** True when the error comes from the user rejecting the wallet prompt. */
export function isUserRejection(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { code?: unknown; message?: unknown; error?: unknown };
  if (e.code === 4001) return true;
  const inner = e.error as { code?: unknown; message?: unknown } | undefined;
  if (inner && typeof inner === "object" && inner.code === 4001) return true;
  const messages = [e.message, inner?.message].filter(
    (m): m is string => typeof m === "string"
  );
  return messages.some((m) =>
    /user rejected|rejected the request|user denied|denied by user|user cancel|declined|request was cancelled/i.test(
      m
    )
  );
}
