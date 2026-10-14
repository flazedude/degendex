// Result types and error mapping for the Trigger action flows (place limit /
// DCA, cancel, withdraw). Pure, so the rules that decide "definitely failed"
// versus "outcome unknown" are unit tested; useTriggerActions wires them up.

import { isUserRejection } from "../errors";
import { isTriggerApiError } from "./client";
import { JUPITER_APP_URL, NEW_ORDERS_PAUSED_MESSAGE, TRIGGER_OFF_MESSAGE, type TriggerMode } from "./config";

export type TriggerActionErrorCode =
  /** Client-side check failed before anything was requested or signed. */
  | "validation"
  /** User rejected the wallet prompt. */
  | "rejected"
  /** Not signed in / session expired: call signIn(). */
  | "auth"
  /** The signed payload expired before Jupiter used it: press again (nothing moved). */
  | "needs_resign"
  | "rate_limited"
  /** Nobody can tell whether the transaction landed: check orders, do not retry yet. */
  | "unknown_outcome"
  /** The transaction Jupiter returned failed our safety checks; nothing was signed. */
  | "unsafe_tx"
  /** Another action is running. */
  | "busy"
  | "disabled"
  | "failed";

export type TriggerActionResult =
  | { ok: true; orderId: string; txSignature?: string }
  | { ok: false; code: TriggerActionErrorCode; error: string; retryAfterMs?: number };

/** prepare: nothing signed yet. sign: wallet prompt. submit: the landing call. */
export type TriggerActionStage = "prepare" | "sign" | "submit";

export const UNKNOWN_OUTCOME_MESSAGE = "Status unknown - check Open orders in a minute";
export const UNKNOWN_ORDER_HOLD_MESSAGE =
  "The last order's status is unknown - check Open orders before placing another";
export const PRICE_DELAYED_MESSAGE = "Price is delayed, try again in a moment";

export const fail = (
  code: TriggerActionErrorCode,
  error: string,
  retryAfterMs?: number
): TriggerActionResult => ({ ok: false, code, error, ...(retryAfterMs ? { retryAfterMs } : {}) });

/** Why an action is refused by the kill switch, or null when it may run. */
export function disabledReason(mode: TriggerMode, action: "new-order" | "manage"): string | null {
  if (mode === "off") return `Limit orders and DCA are turned off here. ${TRIGGER_OFF_MESSAGE}`;
  if (mode === "new-orders-off" && action === "new-order") return NEW_ORDERS_PAUSED_MESSAGE;
  return null;
}

/**
 * True when a failed landing call (create order / confirm-cancel) may still
 * have landed: the proxy said so, the request never came back (network,
 * timeout), any 5xx (platform 502/504 pages never reach our handler), or a
 * response that was not our JSON at all.
 */
export function isUnknownOutcome(err: unknown, stage: TriggerActionStage): boolean {
  if (!isTriggerApiError(err)) return false;
  if (err.unknownOutcome) return true;
  if (stage !== "submit") return false;
  if (err.code === "auth_required" || err.authError || err.code === "rate_limited") return false;
  return (
    err.code === "network" ||
    err.code === "timeout" ||
    err.code === "bad_response" ||
    err.status === 0 ||
    err.status >= 500 ||
    err.nonJson
  );
}

/** Maps any thrown error to a typed result. `stage` decides unknown outcomes. */
export function toFailure(err: unknown, stage: TriggerActionStage): TriggerActionResult {
  if (isUserRejection(err)) return fail("rejected", "Cancelled in wallet");
  if (isTriggerApiError(err)) {
    if (err.code === "auth_required" || err.authError) {
      return fail("auth", "Your limit-order session expired. Sign in again");
    }
    if (err.code === "rate_limited") {
      return fail("rate_limited", "Jupiter is rate limiting requests. Try again in a few seconds", err.retryAfterMs);
    }
    if (isUnknownOutcome(err, stage)) return fail("unknown_outcome", UNKNOWN_OUTCOME_MESSAGE);
    return fail("failed", err.message);
  }
  if (err instanceof Error && err.message) return fail("failed", err.message.slice(0, 200));
  return fail("failed", "Something went wrong");
}

const VAULT_FALLBACK = `You can also withdraw it at ${JUPITER_APP_URL.replace("https://", "")}, which uses the same vault.`;

/**
 * The cancel step went through (the order no longer fills) but the withdrawal
 * Jupiter returned failed our checks. Nothing was signed.
 */
export function withdrawalCheckFailedMessage(reason: string): string {
  return `Safety check failed, nothing was signed: ${reason}. The order is cancelled and its funds are in your Jupiter vault, waiting for a withdrawal. Press Withdraw to try again with a fresh transaction. ${VAULT_FALLBACK}`;
}

export const UNREADABLE_WITHDRAWAL_MESSAGE = `Jupiter returned an unreadable withdrawal, nothing was signed. The order is cancelled and its funds are in your Jupiter vault: press Withdraw to try again. ${VAULT_FALLBACK}`;

export const STOPPED_NOT_WITHDRAWN_MESSAGE =
  "Order stopped, but its funds are still in the Jupiter vault. Press Withdraw to get them back";
